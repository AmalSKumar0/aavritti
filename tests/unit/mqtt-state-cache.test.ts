import { describe, it, expect } from 'vitest';
import { DeviceState } from '@aavritti/shared';

describe('MQTT State Cache & Staleness Logic', () => {
  const mockState: DeviceState = {
    v: 1,
    fw: '1.0.0',
    ts: Math.floor(Date.now() / 1000),
    uptime: 120,
    wifi: { rssi: -58 },
    heap: { free: 45000, min: 40000, largest: 30000 },
    player: {
      state: 'playing',
      station: 'Radio Malayalam',
      url: 'http://stream.test/mp3',
      kbps: 128,
      https: false,
      bufferPct: 95,
      netKBps: 16.0,
      underruns: 0,
      reconnects: 0,
      gapMs: 50,
      volume: 35,
      sleepIn: 0,
    },
  };

  function computeStateResponse(
    isOnline: boolean,
    lastState: DeviceState | null,
    lastReceivedAt: number,
    now: number
  ) {
    const ageMs = lastReceivedAt > 0 ? now - lastReceivedAt : Infinity;
    const stale = !isOnline || ageMs > 15000 || lastState === null;

    return {
      online: isOnline,
      stale,
      ageMs: ageMs === Infinity ? 0 : ageMs,
      state: lastState,
    };
  }

  it('marks state fresh when device is online and state received within 15s', () => {
    const now = Date.now();
    const res = computeStateResponse(true, mockState, now - 3000, now);

    expect(res.online).toBe(true);
    expect(res.stale).toBe(false);
    expect(res.ageMs).toBe(3000);
    expect(res.state).not.toBeNull();
  });

  it('marks state stale when state is older than 15s', () => {
    const now = Date.now();
    const res = computeStateResponse(true, mockState, now - 16000, now);

    expect(res.online).toBe(true);
    expect(res.stale).toBe(true);
    expect(res.ageMs).toBe(16000);
  });

  it('marks state stale when device is offline, even if state was recently received', () => {
    const now = Date.now();
    const res = computeStateResponse(false, mockState, now - 1000, now);

    expect(res.online).toBe(false);
    expect(res.stale).toBe(true);
  });

  it('marks state stale if no state has ever been received', () => {
    const now = Date.now();
    const res = computeStateResponse(true, null, 0, now);

    expect(res.online).toBe(true);
    expect(res.stale).toBe(true);
    expect(res.state).toBeNull();
  });
});
