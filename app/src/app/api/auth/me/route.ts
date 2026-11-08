import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function GET(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, user: session.sub });
}
