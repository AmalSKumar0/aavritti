import { describe, it, expect } from 'vitest';
import {
  CommandSchema,
  DeviceStateSchema,
  AckSchema,
  ApiCommandRequestSchema,
} from '@aavritti/shared';

describe('MQTT Command Schema (Version 1)', () => {
  it('validates play command with http and https URLs', () => {
    const playHttp = {
      v: 1,
      id: 'c_01',
      type: 'play',
      url: 'http://radio.stream.live:8000/stream',
      name: 'Radio Malayalam',
      kbps: 128,
    };
    const parsedHttp = CommandSchema.safeParse(playHttp);
    expect(parsedHttp.success).toBe(true);

    const playHttps = {
      v: 1,
      id: 'c_02',
      type: 'play',
      url: 'https://host.com/mp3',
      name: 'Radio X',
    };
    const parsedHttps = CommandSchema.safeParse(playHttps);
    expect(parsedHttps.success).toBe(true);
    if (parsedHttps.success && parsedHttps.data.type === 'play') {
      expect(parsedHttps.data.kbps).toBe(128); // default kbps
    }
  });

  it('rejects unsupported URL schemes like ftp, javascript, and file', () => {
    const badSchemes = [
      'ftp://server/stream.mp3',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/plain;base64,AAA',
    ];

    for (const url of badSchemes) {
      const res = CommandSchema.safeParse({
        v: 1,
        id: 'c_bad',
        type: 'play',
        url,
      });
      expect(res.success).toBe(false);
    }
  });

  it('validates volume command between 0 and 100', () => {
    const validVol = { v: 1, id: 'c_vol', type: 'volume', value: 35 };
    expect(CommandSchema.safeParse(validVol).success).toBe(true);

    const zeroVol = { v: 1, id: 'c_vol0', type: 'volume', value: 0 };
    expect(CommandSchema.safeParse(zeroVol).success).toBe(true);

    const maxVol = { v: 1, id: 'c_vol100', type: 'volume', value: 100 };
    expect(CommandSchema.safeParse(maxVol).success).toBe(true);

    const negativeVol = { v: 1, id: 'c_neg', type: 'volume', value: -1 };
    expect(CommandSchema.safeParse(negativeVol).success).toBe(false);

    const overVol = { v: 1, id: 'c_over', type: 'volume', value: 101 };
    expect(CommandSchema.safeParse(overVol).success).toBe(false);
  });

  it('validates simple action commands: stop, resume, reboot, ping', () => {
    for (const type of ['stop', 'resume', 'reboot', 'ping']) {
      const res = CommandSchema.safeParse({ v: 1, id: `c_${type}`, type });
      expect(res.success).toBe(true);
    }

    const invalidAction = { v: 1, id: 'c_bad', type: 'invalid_action' };
    expect(CommandSchema.safeParse(invalidAction).success).toBe(false);
  });

  it('validates sleep command minutes', () => {
    const sleep30 = { v: 1, id: 'c_sleep', type: 'sleep', minutes: 30 };
    expect(CommandSchema.safeParse(sleep30).success).toBe(true);

    const cancelSleep = { v: 1, id: 'c_cancel', type: 'sleep', minutes: 0 };
    expect(CommandSchema.safeParse(cancelSleep).success).toBe(true);

    const negSleep = { v: 1, id: 'c_neg', type: 'sleep', minutes: -5 };
    expect(CommandSchema.safeParse(negSleep).success).toBe(false);
  });

  it('validates immediate received ack format', () => {
    const ack = { id: 'c_01', status: 'received' };
    const parsed = AckSchema.safeParse(ack);
    expect(parsed.success).toBe(true);

    const badAck = { id: 'c_01', status: 'unknown' };
    expect(AckSchema.safeParse(badAck).success).toBe(false);
  });
});

describe('Device State Payload Schema', () => {
  it('validates complete device state with all required fields', () => {
    const sampleState = {
      v: 1,
      fw: '1.0.0',
      ts: 1731000000,
      uptime: 3600,
      wifi: { rssi: -58 },
      heap: { free: 48000, min: 41000, largest: 30000 },
      player: {
        state: 'playing',
        station: 'Radio X',
        url: 'https://stream.host/live',
        kbps: 128,
        https: true,
        bufferPct: 98,
        netKBps: 16.1,
        underruns: 0,
        reconnects: 0,
        gapMs: 120,
        volume: 35,
        sleepIn: 0,
      },
      lastCmd: { id: 'c_01', status: 'done', ms: 3120 },
    };

    const parsed = DeviceStateSchema.safeParse(sampleState);
    expect(parsed.success).toBe(true);
  });

  it('validates all player state enum values', () => {
    const states = ['idle', 'connecting', 'buffering', 'playing', 'rebuffering', 'error'];

    for (const st of states) {
      const stateObj = {
        v: 1,
        fw: '1.0.0',
        ts: 1731000000,
        uptime: 10,
        wifi: { rssi: -60 },
        heap: { free: 50000, min: 45000, largest: 35000 },
        player: {
          state: st,
          station: 'Test',
          url: 'http://test',
          kbps: 128,
          https: false,
          bufferPct: 50,
          netKBps: 16.0,
          underruns: 0,
          reconnects: 0,
          gapMs: 0,
          volume: 20,
          sleepIn: 0,
        },
      };
      expect(DeviceStateSchema.safeParse(stateObj).success).toBe(true);
    }
  });
});
