import mqtt, { MqttClient } from 'mqtt';
import {
  getMqttTopics,
  DeviceState,
  DeviceStateSchema,
  DeviceCommand,
  AckSchema,
  DeviceStateResponse,
  DeviceCommandResponse,
} from '@aavritti/shared';

const DEVICE_ID = process.env.DEVICE_ID || 'esp32-radio-01';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;

interface PendingAckWait {
  resolve: (status: 'received' | 'pending') => void;
  timer: NodeJS.Timeout;
}

class MqttService {
  private client: MqttClient | null = null;
  private connectingPromise: Promise<void> | null = null;
  private topics = getMqttTopics(DEVICE_ID);

  private lastState: DeviceState | null = null;
  private lastStateTimestamp: number = 0;
  private isOnline: boolean = false;
  private authError: boolean = false;

  private pendingAcks = new Map<string, PendingAckWait>();
  private coldStartResolvers: Array<() => void> = [];

  constructor() {
    // Lazy initialization on first invocation
  }

  public async getClient(): Promise<MqttClient> {
    if (this.authError) {
      throw new Error('MQTT_AUTH_FAILED: Broker rejected authentication credentials');
    }

    if (this.client && this.client.connected) {
      return this.client;
    }

    if (this.connectingPromise) {
      await this.connectingPromise;
      if (this.client && this.client.connected) {
        return this.client;
      }
    }

    this.connectingPromise = this.connect();
    await this.connectingPromise;
    this.connectingPromise = null;

    if (!this.client || !this.client.connected) {
      if (this.authError) {
        throw new Error('MQTT_AUTH_FAILED: Broker rejected authentication credentials');
      }
      throw new Error('MQTT_CONNECT_FAILED: Unable to connect to broker');
    }

    return this.client;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.authError = false;

      const client = mqtt.connect(MQTT_URL, {
        clientId: `aavritti-backend-${Math.random().toString(16).substring(2, 8)}`,
        clean: true,
        connectTimeout: 5000,
        keepalive: 30,
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        reconnectPeriod: 2000,
      });

      this.client = client;

      client.on('connect', () => {
        // Subscribe to state, online, and ack topics with QoS 1
        client.subscribe(
          [this.topics.state, this.topics.online, this.topics.ack],
          { qos: 1 },
          (err) => {
            if (err) {
              console.error('[MQTT Backend] Subscribe error:', err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });

      client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload.toString());
      });

      client.on('error', (err: Error & { returnCode?: number }) => {
        console.error('[MQTT Backend] Error:', err.message);
        if (
          err.message.includes('Bad username or password') ||
          err.message.includes('Not authorized') ||
          err.returnCode === 4 ||
          err.returnCode === 5
        ) {
          this.authError = true;
          reject(new Error('MQTT_AUTH_FAILED'));
        }
      });

      // Timeout safety for serverless invocation
      setTimeout(() => {
        if (!client.connected) {
          resolve(); // Let caller handle state
        }
      }, 4000);
    });
  }

  private handleMessage(topic: string, message: string) {
    if (topic === this.topics.online) {
      this.isOnline = message.trim().toLowerCase() === 'online';
    } else if (topic === this.topics.state) {
      try {
        const json = JSON.parse(message);
        const parsed = DeviceStateSchema.safeParse(json);
        if (parsed.success) {
          this.lastState = parsed.data;
          this.lastStateTimestamp = Date.now();

          // Resolve any cold-start state waiters
          while (this.coldStartResolvers.length > 0) {
            const cb = this.coldStartResolvers.shift();
            if (cb) cb();
          }
        }
      } catch (e) {
        console.error('[MQTT Backend] Failed to parse device state:', e);
      }
    } else if (topic === this.topics.ack) {
      try {
        const json = JSON.parse(message);
        const parsed = AckSchema.safeParse(json);
        if (parsed.success) {
          const ack = parsed.data;
          const waiter = this.pendingAcks.get(ack.id);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.pendingAcks.delete(ack.id);
            waiter.resolve('received');
          }
        }
      } catch (e) {
        console.error('[MQTT Backend] Failed to parse ack:', e);
      }
    }
  }

  public async getState(): Promise<DeviceStateResponse> {
    try {
      await this.getClient();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('MQTT_AUTH_FAILED')) {
        throw err;
      }
    }

    // On cold start, wait up to 1.5s for retained state to arrive
    if (this.lastState === null && this.client?.connected) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolve();
        }, 1500);

        this.coldStartResolvers.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    const now = Date.now();
    const ageMs = this.lastStateTimestamp > 0 ? now - this.lastStateTimestamp : Infinity;
    // Stale if state older than 15s or device marked offline
    const stale = !this.isOnline || ageMs > 15000 || this.lastState === null;

    return {
      online: this.isOnline,
      stale,
      ageMs: ageMs === Infinity ? 0 : ageMs,
      state: this.lastState,
    };
  }

  public async publishCommand(cmd: DeviceCommand): Promise<DeviceCommandResponse> {
    const client = await this.getClient();
    const payload = JSON.stringify(cmd);

    // 1. Wait for PUBACK from broker (QoS 1)
    await new Promise<void>((resolve, reject) => {
      client.publish(this.topics.cmd, payload, { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 2. Wait up to 3s for device "received" ack
    const ackStatus = await new Promise<'received' | 'pending'>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(cmd.id);
        resolve('pending');
      }, 3000);

      this.pendingAcks.set(cmd.id, { resolve, timer });
    });

    return {
      id: cmd.id,
      ack: ackStatus,
    };
  }

  public isConnected(): boolean {
    return this.client !== null && this.client.connected;
  }
}

// Module-level singleton across serverless invocations
declare global {
  // eslint-disable-next-line no-var
  var __aavritti_mqtt: MqttService | undefined;
}

export const mqttService = global.__aavritti_mqtt || new MqttService();
if (process.env.NODE_ENV !== 'production') {
  global.__aavritti_mqtt = mqttService;
}
