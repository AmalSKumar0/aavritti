import mqtt, { MqttClient } from 'mqtt';
import {
  getMqttTopics,
  DeviceState,
  PlayerStateType,
  CommandSchema,
  DeviceCommand,
} from '@aavritti/shared';

const DEVICE_ID = process.env.DEVICE_ID || 'esp32-radio-01';
const BROKER_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const USERNAME = process.env.MQTT_USERNAME || undefined;
const PASSWORD = process.env.MQTT_PASSWORD || undefined;

const topics = getMqttTopics(DEVICE_ID);

console.log(`[SIMULATOR] Starting ESP32 Radio Simulator for device: ${DEVICE_ID}`);
console.log(`[SIMULATOR] Connecting to: ${BROKER_URL}`);

let client: MqttClient;

// Internal radio state
let playerState: PlayerStateType = 'idle';
let currentStation = 'Malayalam Hits FM';
let currentUrl = 'https://stream.malayalamhits.live/stream';
let currentKbps = 128;
let isHttps = true;
let currentVolume = 35; // 0..100
let bufferPct = 0;
let netKBps = 0;
let underruns = 0;
let reconnects = 0;
let gapMs = 45;
let sleepUntilMs = 0; // 0 = no sleep timer
let bootTime = Date.now();

let lastCmdResult: DeviceState['lastCmd'] = undefined;
const recentCmdIds: string[] = []; // ring buffer of 16 ids

let statePublishTimer: NodeJS.Timeout | null = null;
let lastPublishTime = 0;
let transitionTimeout: NodeJS.Timeout | null = null;

function buildStatePayload(): DeviceState {
  const now = Date.now();
  const uptimeSec = Math.floor((now - bootTime) / 1000);
  const sleepInMinutes =
    sleepUntilMs > now ? Math.ceil((sleepUntilMs - now) / 60000) : 0;

  // Simulate realistic ESP32 heap
  const freeHeap = isHttps
    ? playerState === 'playing'
      ? 34500 + Math.floor(Math.random() * 2000)
      : 52000
    : playerState === 'playing'
    ? 48000 + Math.floor(Math.random() * 2000)
    : 58000;

  return {
    v: 1,
    fw: '1.0.0',
    ts: Math.floor(now / 1000),
    uptime: uptimeSec,
    wifi: {
      rssi: -58 + Math.floor(Math.random() * 5) - 2,
    },
    heap: {
      free: freeHeap,
      min: freeHeap - 4000,
      largest: Math.floor(freeHeap * 0.65),
    },
    player: {
      state: playerState,
      station: currentStation,
      url: currentUrl,
      kbps: currentKbps,
      https: isHttps,
      bufferPct: Math.round(bufferPct),
      netKBps: Number(netKBps.toFixed(1)),
      underruns,
      reconnects,
      gapMs,
      volume: currentVolume,
      sleepIn: sleepInMinutes,
    },
    lastCmd: lastCmdResult,
  };
}

function publishState(force = false) {
  const now = Date.now();
  if (!force && now - lastPublishTime < 1000) {
    // Rate limit: at most 1 publish per second
    return;
  }
  lastPublishTime = now;

  const state = buildStatePayload();
  const payload = JSON.stringify(state);

  client.publish(topics.state, payload, { qos: 1, retain: true }, (err) => {
    if (err) {
      console.error('[SIMULATOR] Error publishing state:', err);
    }
  });

  resetPeriodicTimer();
}

function resetPeriodicTimer() {
  if (statePublishTimer) {
    clearTimeout(statePublishTimer);
  }
  // 5s while playing, 15s while idle/other
  const interval = playerState === 'playing' ? 5000 : 15000;
  statePublishTimer = setTimeout(() => {
    publishState(true);
  }, interval);
}

function connect() {
  client = mqtt.connect(BROKER_URL, {
    clientId: DEVICE_ID,
    clean: false, // clean_session=false as per requirement
    keepalive: 30,
    username: USERNAME,
    password: PASSWORD,
    will: {
      topic: topics.online,
      payload: Buffer.from('offline'),
      qos: 1,
      retain: true,
    },
  });

  client.on('connect', () => {
    console.log('[SIMULATOR] Connected to MQTT broker');

    // 1. Publish online = "online" (retained, QoS 1)
    client.publish(topics.online, 'online', { qos: 1, retain: true });

    // 2. Subscribe to cmd topic (QoS 1)
    client.subscribe(topics.cmd, { qos: 1 }, (err) => {
      if (err) {
        console.error('[SIMULATOR] Failed to subscribe to cmd topic:', err);
      } else {
        console.log(`[SIMULATOR] Subscribed to ${topics.cmd}`);
      }
    });

    // 3. Publish initial state
    publishState(true);
  });

  client.on('message', (topic, message) => {
    if (topic === topics.cmd) {
      handleCommand(message.toString());
    }
  });

  client.on('error', (err) => {
    console.error('[SIMULATOR] MQTT client error:', err);
  });

  client.on('close', () => {
    console.log('[SIMULATOR] Connection closed');
  });
}

function handleCommand(raw: string) {
  const startTime = Date.now();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('[SIMULATOR] Invalid JSON received on cmd:', raw);
    return;
  }

  const parsed = CommandSchema.safeParse(json);
  if (!parsed.success) {
    console.error('[SIMULATOR] Command validation failed:', parsed.error.format());
    return;
  }

  const cmd: DeviceCommand = parsed.data;

  // Deduplication check: remember last 16 IDs
  if (recentCmdIds.includes(cmd.id)) {
    console.log(`[SIMULATOR] Dropping duplicate command id=${cmd.id}`);
    return;
  }
  recentCmdIds.push(cmd.id);
  if (recentCmdIds.length > 16) {
    recentCmdIds.shift();
  }

  console.log(`[SIMULATOR] Received command type=${cmd.type} id=${cmd.id}`);

  // Send immediate "received" ack from MQTT handler
  const ackPayload = JSON.stringify({ id: cmd.id, status: 'received' });
  client.publish(topics.ack, ackPayload, { qos: 1, retain: false });

  // Execute command
  executeCommand(cmd, startTime);
}

function executeCommand(cmd: DeviceCommand, startTime: number) {
  if (transitionTimeout) {
    clearTimeout(transitionTimeout);
    transitionTimeout = null;
  }

  switch (cmd.type) {
    case 'play': {
      if (!cmd.url.startsWith('http://') && !cmd.url.startsWith('https://')) {
        lastCmdResult = {
          id: cmd.id,
          status: 'failed',
          error: 'URL must start with http:// or https://',
          ms: Date.now() - startTime,
        };
        publishState(true);
        return;
      }

      currentUrl = cmd.url;
      currentStation = cmd.name || 'Station';
      currentKbps = cmd.kbps || 128;
      isHttps = currentUrl.startsWith('https://');

      // Transition to connecting
      playerState = 'connecting';
      bufferPct = 10;
      netKBps = 0;
      publishState(true);

      // Simulate network connection (800ms) -> buffering (2200ms) -> playing
      transitionTimeout = setTimeout(() => {
        playerState = 'buffering';
        bufferPct = 45;
        netKBps = 16.2;
        publishState(true);

        transitionTimeout = setTimeout(() => {
          playerState = 'playing';
          bufferPct = 96;
          netKBps = 16.0;
          lastCmdResult = {
            id: cmd.id,
            status: 'done',
            ms: Date.now() - startTime,
          };
          console.log(`[SIMULATOR] Now playing: ${currentStation}`);
          publishState(true);
        }, 1800);
      }, 800);
      break;
    }

    case 'volume': {
      currentVolume = Math.max(0, Math.min(100, cmd.value));
      lastCmdResult = {
        id: cmd.id,
        status: 'done',
        ms: Date.now() - startTime,
      };
      console.log(`[SIMULATOR] Volume changed to ${currentVolume}%`);
      publishState(true);
      break;
    }

    case 'stop': {
      playerState = 'idle';
      bufferPct = 0;
      netKBps = 0;
      lastCmdResult = {
        id: cmd.id,
        status: 'done',
        ms: Date.now() - startTime,
      };
      console.log('[SIMULATOR] Stream stopped');
      publishState(true);
      break;
    }

    case 'resume': {
      playerState = 'buffering';
      bufferPct = 60;
      publishState(true);

      transitionTimeout = setTimeout(() => {
        playerState = 'playing';
        bufferPct = 98;
        netKBps = 16.0;
        lastCmdResult = {
          id: cmd.id,
          status: 'done',
          ms: Date.now() - startTime,
        };
        console.log('[SIMULATOR] Resumed playing');
        publishState(true);
      }, 1200);
      break;
    }

    case 'sleep': {
      if (cmd.minutes === 0) {
        sleepUntilMs = 0;
        console.log('[SIMULATOR] Sleep timer cancelled');
      } else {
        sleepUntilMs = Date.now() + cmd.minutes * 60000;
        console.log(`[SIMULATOR] Sleep timer set for ${cmd.minutes} minutes`);
      }
      lastCmdResult = {
        id: cmd.id,
        status: 'done',
        ms: Date.now() - startTime,
      };
      publishState(true);
      break;
    }

    case 'ping': {
      lastCmdResult = {
        id: cmd.id,
        status: 'done',
        ms: Date.now() - startTime,
      };
      publishState(true);
      break;
    }

    case 'reboot': {
      console.log('[SIMULATOR] ESP32 rebooting...');
      lastCmdResult = {
        id: cmd.id,
        status: 'done',
        ms: Date.now() - startTime,
      };
      publishState(true);

      setTimeout(() => {
        client.publish(topics.online, 'offline', { qos: 1, retain: true });
        client.end(true, () => {
          console.log('[SIMULATOR] Offline for reboot...');
          setTimeout(() => {
            bootTime = Date.now();
            playerState = 'idle';
            connect();
          }, 2000);
        });
      }, 200);
      break;
    }
  }
}

// Check sleep timer periodically
setInterval(() => {
  if (sleepUntilMs > 0 && Date.now() >= sleepUntilMs) {
    console.log('[SIMULATOR] Sleep timer expired, stopping audio');
    sleepUntilMs = 0;
    if (playerState !== 'idle') {
      playerState = 'idle';
      bufferPct = 0;
      netKBps = 0;
      publishState(true);
    }
  }
}, 5000);

connect();
