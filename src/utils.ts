export interface Device {
  id: string;
  channels: Channel[];
  serial?: string | null;
  label?: string | null;
  model?: string | null;
  // type?: string; // "datalogger" ?
  firmware?: string | null; // Firmware version
  // locationId?: string;
  battery?: number | null; // Battery percentage
  // wifiSignal?: number; // dBm
  // gatewaySignal?: number; // ?
  lastSeen?: string | null; // Last time sensor was seen
  nextExpectedConnection?: string | null; // When the sensor is expected to connect next
  transmitIntervalSeconds?: number | null; // In seconds, how often the sensor should wake up and send readings
}

export interface Channel {
  id: string;
  enabled: boolean;
  // alarming: boolean;
  probeFailed: boolean;
  // number?: number;
  label?: string | null;
  type?: string | null;
  value?: number | null; // Latest reading in `units`
  units?: string | null;
  status?: string | null;
  // alarmHigh?: Alarm
  // alarmLow?: Alarm
  minimum?: number | null;
  maximum?: number | null;
  lastTelemetrySaved?: string | null; // Timestamp of the channel's latest telemetry reading, not contact or API polling time. Null when unavailable.
  lastSeen?: string | null;
}

export interface ThermoworksApiResponse {
  status: number;
  devices?: Device[];
  etag?: string;
  retryAfterSeconds?: number;
}

export const formatErrorMessage = (errorMessage: string, errorContext?: string): string => {
  return `${errorContext ? errorContext : ''} Report the following response in our issue tracker: ` +
          'https://github.com/gorhack/thermoworks/issues\n' +
          `${errorMessage}`;
};

export const requestThermoworksApi = async (apiUrl: string, apiKey: string, etag?: string): Promise<ThermoworksApiResponse> => {
  // returns the `data` from the requested API
  const headers = new Headers();
  headers.append('X-API-Key', apiKey);
  headers.append('Content-Type', 'application/json');
  if (etag) {
    headers.append('If-None-Match', etag);
  }
  const res = await fetch(apiUrl, { headers: headers });
  const response: ThermoworksApiResponse = {
    status: res.status,
    etag: res.headers.get('ETag') ?? etag,
  };
  if (res.status === 304 || res.status === 401) {
    return response;
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds)) {
        response.retryAfterSeconds = retryAfterSeconds;
      } else {
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
          response.retryAfterSeconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
        }
      }
    }
    return response;
  }
  if (res.status !== 200) {
    // catch all non-200 error codes (400, 500, etc)
    throw new Error(formatErrorMessage(JSON.stringify(res),
      `Received a bad response code ${apiUrl} (not '200', '304', '401', or '429') resulting in the inability to request your device(s). ` +
        'Check the API at https://cloud.thermoworks.com/api/docs/'));
  }
  const jsonData = (await res.json());
  response.devices = jsonData.devices;
  return response;
};

export const isHumidityChannel = (channel: Channel): boolean => channel.units === 'H';

export const channelReading = (channel: Channel): number | undefined => {
  if (channel.value === undefined || channel.value === null) {
    return undefined;
  }
  if (channel.units === 'F') {
    return Math.round(((channel.value - 32) * 5 / 9) * 10) / 10;
  }
  if (channel.units === 'C') {
    return channel.value;
  }
  if (channel.units === 'H') {
    return Math.round(channel.value);
  }
  return undefined;
};

export const nextPollDelayMs = (devices: Device[], extraDelaySeconds = 0): number => {
  const now = Date.now();
  const expectedTimes = devices.map(device => {
    if (device.nextExpectedConnection) {
      const expectedConnection = Date.parse(device.nextExpectedConnection);
      if (Number.isFinite(expectedConnection)) {
        return expectedConnection;
      }
    }
    if (device.lastSeen && device.transmitIntervalSeconds != null) {
      const lastSeen = Date.parse(device.lastSeen);
      if (Number.isFinite(lastSeen)) {
        return lastSeen + device.transmitIntervalSeconds * 1000;
      }
    }
    return undefined;
  }).filter((expectedTime): expectedTime is number => expectedTime !== undefined);
  const nextExpectedTime = expectedTimes.length > 0 ? Math.min(...expectedTimes) : now + 300_000;
  // 15 seconds or next expected time
  return Math.max(15_000, nextExpectedTime - now + extraDelaySeconds * 1000);
};
