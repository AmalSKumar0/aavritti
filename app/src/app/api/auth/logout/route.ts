import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, validateMutationRequest } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden: Missing CSRF headers' }, { status: 403 });
  }

  const res = NextResponse.json({ success: true, message: 'Logged out' });
  clearSessionCookie(res);
  return res;
}
