import { NextRequest, NextResponse } from 'next/server';
import { validateMutationRequest, verifySession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { stationuuid } = await req.json();
    if (!stationuuid || typeof stationuuid !== 'string') {
      return NextResponse.json({ error: 'Missing stationuuid' }, { status: 400 });
    }

    // Call Radio Browser url click count endpoint asynchronously
    fetch(`https://all.api.radio-browser.info/json/url/${encodeURIComponent(stationuuid)}`, {
      method: 'POST',
      headers: { 'User-Agent': 'AavrittiRadio/1.0' },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
