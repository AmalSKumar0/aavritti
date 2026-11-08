import { describe, it, expect, vi } from 'vitest';
import { checkStream } from '@/lib/ssrf';

describe('Stream Checker', () => {
  it('correctly assesses standard MP3 streams as compatible', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      finalUrl: 'http://stream.radio.com:8000/live.mp3',
      statusCode: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'icy-name': 'Malayalam Hits FM',
        'icy-br': '128',
        'icy-genre': 'Malayalam',
      },
    });

    const report = await checkStream('http://stream.radio.com:8000/live.mp3', mockFetch);

    expect(report.compatible).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.isHttps).toBe(false);
    expect(report.icyName).toBe('Malayalam Hits FM');
    expect(report.icyBitrate).toBe(128);
    expect(report.notes).toContain('Compatible MP3 audio stream.');
  });

  it('rejects AAC stream with clear message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      finalUrl: 'http://stream.radio.com/stream.aac',
      statusCode: 200,
      headers: {
        'content-type': 'audio/aac',
        'icy-name': 'AAC Radio',
      },
    });

    const report = await checkStream('http://stream.radio.com/stream.aac', mockFetch);

    expect(report.compatible).toBe(false);
    expect(report.status).toBe('incompatible');
    expect(report.notes.some((n) => n.includes('decodes MP3 only'))).toBe(true);
  });

  it('rejects HLS m3u8 streams with clear message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      finalUrl: 'https://cdn.station.com/live/playlist.m3u8',
      statusCode: 200,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
      },
    });

    const report = await checkStream('https://cdn.station.com/live/playlist.m3u8', mockFetch);

    expect(report.compatible).toBe(false);
    expect(report.status).toBe('incompatible');
    expect(report.notes.some((n) => n.includes('decodes MP3 only'))).toBe(true);
  });

  it('warns about high bitrate streams (> 192 kbps)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      finalUrl: 'http://stream.radio.com/320kbps.mp3',
      statusCode: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'icy-br': '320',
      },
    });

    const report = await checkStream('http://stream.radio.com/320kbps.mp3', mockFetch);

    expect(report.compatible).toBe(true);
    expect(report.status).toBe('warning');
    expect(report.notes.some((n) => n.includes('Recommended <= 192 kbps'))).toBe(true);
  });

  it('adds HTTPS TLS RAM warning when URL uses HTTPS', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      finalUrl: 'https://secure.stream.com/live.mp3',
      statusCode: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'icy-br': '128',
      },
    });

    const report = await checkStream('https://secure.stream.com/live.mp3', mockFetch);

    expect(report.isHttps).toBe(true);
    expect(report.notes.some((n) => n.includes('TLS heap buffer'))).toBe(true);
  });
});
