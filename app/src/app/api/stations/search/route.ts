import { NextRequest, NextResponse } from 'next/server';
import { StationItem } from '@aavritti/shared';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

const RADIO_BROWSER_HOSTS = [
  'de1.api.radio-browser.info',
  'all.api.radio-browser.info',
  'nl1.api.radio-browser.info',
];

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  language: string;
  votes: number;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const language = searchParams.get('language') || 'malayalam';
  const country = searchParams.get('country') || 'India';
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));

  const queryParams = new URLSearchParams({
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
    limit: limit.toString(),
  });

  if (q.trim()) {
    queryParams.set('name', q.trim());
  }
  if (language) {
    queryParams.set('language', language);
  }
  if (country) {
    queryParams.set('country', country);
  }

  let data: RadioBrowserStation[] | null = null;
  let lastErr: unknown = null;

  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      const url = `https://${host}/json/stations/search?${queryParams.toString()}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'AavrittiRadio/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        data = (await res.json()) as RadioBrowserStation[];
        break;
      }
    } catch (err) {
      lastErr = err;
      continue;
    }
  }

  if (!data) {
    console.error('[API /stations/search] Radio browser failed:', lastErr);
    return NextResponse.json(
      { error: 'Radio Browser API is currently unreachable' },
      { status: 502 }
    );
  }

  const results: StationItem[] = data.map((st) => {
    const codec = (st.codec || '').toUpperCase();
    const isHls = st.hls === 1 || st.url_resolved.includes('.m3u8') || st.url.includes('.m3u8');
    const bitrate = st.bitrate || 0;

    // ESP32 compatibility: MP3 only, not HLS, bitrate <= 192
    const esp32Compatible = codec === 'MP3' && !isHls && (bitrate <= 192 || bitrate === 0);

    return {
      id: st.stationuuid,
      name: st.name.trim() || 'Untitled Station',
      url_resolved: st.url_resolved || st.url,
      bitrate,
      codec,
      favicon: st.favicon || undefined,
      votes: st.votes || 0,
      esp32Compatible,
      country: st.country || undefined,
      language: st.language || undefined,
    };
  });

  return NextResponse.json(results, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
