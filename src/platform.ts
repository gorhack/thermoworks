import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { ThermoworksAccessory } from './platformAccessory.js';
import { Device, formatErrorMessage, nextPollDelayMs, requestThermoworksApi } from './utils.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ThermoworksHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // public api (latest)
  public readonly thermoworksApiUrl: string = 'https://api.cloud.thermoworks.com/v1/';
  private readonly accessoryHandlers = new Map<string, ThermoworksAccessory>();
  private devices: Device[] = [];
  private etag?: string;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private pollingStopped = false;

  constructor(
      public readonly log: Logging,
      public readonly config: PlatformConfig,
      public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    // Homebridge 1.8.0 introduced a `log.success` method that can be used to log success messages
    // For users that are on a version prior to 1.8.0, we need a 'polyfill' for this method
    if (!log.success) {
      log.success = log.info;
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    if (!this.config.apiKey) {
      this.log.error('Must have an API key configured in the plugin configuration.');
      return;
    }
    this.log.debug('Discovering ThermoWorks devices.');
    void this.pollDevices();
  }

  private async pollDevices() {
    if (this.pollingStopped || !this.config.apiKey) {
      return;
    }

    try {
      const response = await requestThermoworksApi(this.thermoworksApiUrl + 'devices', this.config.apiKey, this.etag);
      if (response.status === 401) {
        this.log.error('ThermoWorks API authentication failed. Check the configured API key.');
        this.pollingStopped = true;
        return;
      }
      if (response.status === 429) {
        this.log.warn('ThermoWorks API rate limit reached; delaying the next request.');
        this.schedulePoll(Math.max(60_000, (response.retryAfterSeconds ?? 60) * 1000));
        return;
      }
      if (response.status === 304) {
        this.schedulePoll(this.getNextPollDelay());
        return;
      }

      this.etag = response.etag;
      this.devices = response.devices ?? [];
      const seenAccessories = new Set<string>();
      this.devices.forEach(device => {
        const uuid = this.api.hap.uuid.generate(device.id);
        seenAccessories.add(uuid);
        this.registerOrUpdateAccessory(device, uuid);
      });
      this.accessoryHandlers.forEach((handler, uuid) => {
        if (!seenAccessories.has(uuid)) {
          handler.markFaulted();
          this.log.warn(`ThermoWorks device for accessory ${uuid} was not returned by the API.`);
        }
      });
      this.devices.forEach(device => {
        this.log.info(`Device ${device.id} -- ${device.label}/${device.model}. ` +
          `It has ${device.channels.length} sensor(s). Last checkin ${device.lastSeen ?? 'unknown'}. ` +
          `Next connection ${device.nextExpectedConnection ?? 'unknown'} with an interval of ${device.transmitIntervalSeconds} seconds.`);
        device.channels.forEach(channel => {
          this.log.info(`Sensor ${channel.id} -- ${channel.type} - ${channel.label ?? '[null]'}: ` +
          `${channel.value ?? ''} ${channel.units ?? ''}. Device is ${channel.enabled ? 'enabled' : 'disabled'} ` +
          `and status is ${channel.status ?? 'unknown'}. Last seen ${channel.lastSeen ?? 'unknown'}.`);
        });
      });

      const pollDelay = this.getNextPollDelay();
      this.log.info(`Next poll in ${Math.floor(pollDelay / 1000)}s.`);

      this.schedulePoll(pollDelay);
    } catch (err) {
      this.accessoryHandlers.forEach(handler => handler.markFaulted());
      if (err instanceof TypeError) {
        this.log.error(formatErrorMessage(err.stack ?? err.message, 'Unknown TypeError.'));
      } else if (err instanceof Error) {
        this.log.error(formatErrorMessage(err.stack ?? err.message, 'Error requesting all devices'));
      } else {
        this.log.error(formatErrorMessage(String(err), 'Unknown error.'));
      }
      this.schedulePoll(this.getNextPollDelay());
    }
  }

  private registerOrUpdateAccessory(device: Device, uuid: string) {
    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context.device = device;
      const handler = this.accessoryHandlers.get(uuid);
      if (handler) {
        handler.updateDevice(device);
      } else {
        this.accessoryHandlers.set(uuid, new ThermoworksAccessory(this, existingAccessory));
      }
      this.api.updatePlatformAccessories([existingAccessory]);
      return;
    }

    // the accessory does not yet exist, so we need to create it
    const accessory = new this.api.platformAccessory(device.label || device.model || device.id, uuid);
    accessory.context.device = device;
    this.accessoryHandlers.set(uuid, new ThermoworksAccessory(this, accessory));
    this.accessories.push(accessory);

    // link the accessory to your platform
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private getNextPollDelay(): number {
    const configuredDelay = Number(this.config.delay);
    const extraDelaySeconds = Number.isFinite(configuredDelay) && configuredDelay > 0 ? configuredDelay : 0;
    return nextPollDelayMs(this.devices, extraDelaySeconds);
  }

  private schedulePoll(delayMs: number) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollDevices();
    }, delayMs);
  }
}