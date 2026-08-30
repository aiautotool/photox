export type DevicePlatform = 'ios'|'android'|'windows'|'macos'|'linux'|'unknown';

export interface Device {
  id: string;
  name: string;
  platform: DevicePlatform;
  appVersion?: string;
  lastSeenAt?: string;
}

export interface PairingCredentials {
  deviceId: string;
  pairCode: string;
  endpoint: string;
  token?: string;
  expiresAt?: string;
}

export interface DeviceSession {
  device: Device;
  connectedAt: string;
  transportId: string;
  authenticated: boolean;
}
