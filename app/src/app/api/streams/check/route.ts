import { NextRequest, NextResponse } from 'next/server';
import { verifySession, validateMutationRequest } from '@/lib/auth';
import { checkStream } from '@/lib/ssrf';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

const CheckStreamSchema = z.object({
  url: z.string().url().max(512),
});

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden: Missing CSRF headers' }, { status: 403 });
  }

  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = CheckStreamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid URL. Must be a valid http:// or https:// URL.' },
        { status: 400 }
      );
    }

    const report = await checkStream(parsed.data.url);
    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to inspect stream';
    const isSecurityError = message.includes('Forbidden') || message.includes('private');

    return NextResponse.json(
      { error: message, securityBlocked: isSecurityError },
      { status: isSecurityError ? 403 : 400 }
    );
  }
}
