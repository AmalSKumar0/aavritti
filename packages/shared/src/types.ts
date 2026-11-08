export * from './schemas';
export * from './mqtt';

export interface DeviceStateResponse {
  online: boolean;
  stale: boolean;
  ageMs: number;
  state: import('./schemas').DeviceState | null;
}

export interface DeviceCommandResponse {
  id: string;
  ack: 'received' | 'pending';
}
