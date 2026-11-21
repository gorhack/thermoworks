import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ThermoworksHomebridgePlatform } from './platform.js';
import { channelReading, Device, isHumidityChannel } from './utils.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ThermoworksAccessory {
  private readonly channelStates = new Map<string, { value?: number; fault: boolean }>();
  private readonly channelServices = new Map<string, Service>();
  private lowBattery: number;

  constructor(
      private readonly platform: ThermoworksHomebridgePlatform,
      private readonly accessory: PlatformAccessory,
  ) {
    this.lowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    this.updateDevice(this.accessory.context.device);
  }

  updateDevice(device: Device) {
    this.accessory.context.device = device;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ThermoWorks')
      .setCharacteristic(this.platform.Characteristic.Model, device.model ?? 'ThermoWorks')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.serial ?? device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, device.firmware ?? 'Unknown');

    this.lowBattery = device.battery != null && device.battery < 30
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    const activeServices = new Set<Service>();
    const activeChannels = new Set<string>();

    device.channels.filter(channel => channel.enabled).forEach(channel => {
      const humidity = isHumidityChannel(channel);
      const serviceType = humidity
        ? this.platform.Service.HumiditySensor
        : channel.units === 'F' || channel.units === 'C'
          ? this.platform.Service.TemperatureSensor
          : undefined;
      if (!serviceType) {
        return;
      }

      // Use the channel id as the subtype so one device can expose multiple services of the same type.
      const service = this.accessory.getServiceById(serviceType, channel.id)
        || this.accessory.addService(serviceType, channel.label || channel.type || `Channel ${channel.id}`, channel.id);
      const name = channel.label || channel.type || `${device.label || this.accessory.displayName} Channel ${channel.id}`;
      service.setCharacteristic(this.platform.Characteristic.Name, name);
      if (humidity) {
        service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
          .onGet(() => this.handleReadingGet(channel.id));
      } else {
        service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .onGet(() => this.handleReadingGet(channel.id));
      }
      service.getCharacteristic(this.platform.Characteristic.StatusFault)
        .onGet(() => this.handleStatusFaultGet(channel.id));
      service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
        .onGet(() => this.lowBattery);

      const value = channelReading(channel);
      const fault = channel.probeFailed || value === undefined;
      this.channelStates.set(channel.id, { value, fault });
      this.channelServices.set(channel.id, service);
      activeServices.add(service);
      activeChannels.add(channel.id);

      if (value !== undefined) {
        service.updateCharacteristic(
          humidity ? this.platform.Characteristic.CurrentRelativeHumidity : this.platform.Characteristic.CurrentTemperature,
          value,
        );
      }
      service.updateCharacteristic(this.platform.Characteristic.StatusFault,
        fault ? this.platform.Characteristic.StatusFault.GENERAL_FAULT : this.platform.Characteristic.StatusFault.NO_FAULT);
      service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.lowBattery);
    });

    this.accessory.services.slice().forEach(service => {
      const isChannelService = service.UUID === this.platform.Service.TemperatureSensor.UUID
        || service.UUID === this.platform.Service.HumiditySensor.UUID;
      if (isChannelService && !activeServices.has(service)) {
        this.accessory.removeService(service);
      }
    });

    this.channelStates.forEach((_state, channelId) => {
      if (!activeChannels.has(channelId)) {
        this.channelStates.delete(channelId);
        this.channelServices.delete(channelId);
      }
    });
  }

  markFaulted() {
    this.channelStates.forEach(state => {
      state.fault = true;
    });
    this.channelServices.forEach(service => {
      service.updateCharacteristic(this.platform.Characteristic.StatusFault,
        this.platform.Characteristic.StatusFault.GENERAL_FAULT);
    });
  }

  private handleReadingGet(channelId: string): CharacteristicValue {
    const state = this.channelStates.get(channelId);
    if (!state || state.fault || state.value === undefined) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return state.value;
  }

  private handleStatusFaultGet(channelId: string): CharacteristicValue {
    const state = this.channelStates.get(channelId);
    return state?.fault
      ? this.platform.Characteristic.StatusFault.GENERAL_FAULT
      : this.platform.Characteristic.StatusFault.NO_FAULT;
  }
}