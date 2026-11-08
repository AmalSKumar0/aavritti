/**
 * MQTT v1 Topics and Contracts for Aavritti ESP32 Radio
 */

export interface MqttTopics {
  cmd: string;
  state: string;
  ack: string;
  online: string;
  wildcard: string;
}

export function getMqttTopics(deviceId: string): MqttTopics {
  const prefix = `aavritti/v1/${deviceId}`;
  return {
    cmd: `${prefix}/cmd`,
    state: `${prefix}/state`,
    ack: `${prefix}/ack`,
    online: `${prefix}/online`,
    wildcard: `${prefix}/#`,
  };
}

export const MQTT_CONFIG = {
  version: 1,
  keepalive: 30, // seconds
  cleanSession: false,
  qos: 1 as const,
  retainedState: true,
  retainedOnline: true,
  stateRateLimitMs: 1000,
  playingIntervalMs: 5000,
  idleIntervalMs: 15000,
  cmdTimeoutMs: 3000,
  coldStartRetainedTimeoutMs: 1500,
};
