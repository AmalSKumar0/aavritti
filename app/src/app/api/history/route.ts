import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getHistory } from '@/lib/redis';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function GET(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const history = await getHistory();
  return NextResponse.json(history);
}
