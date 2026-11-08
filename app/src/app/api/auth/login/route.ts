import { NextRequest, NextResponse } from 'next/server';
import {
  checkLoginRateLimit,
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  validateMutationRequest,
} from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

const LoginRequestSchema = z.object({
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden: Missing CSRF headers' }, { status: 403 });
  }

  // Rate limiting per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait 1 minute.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid password format' }, { status: 400 });
    }

    const valid = await verifyPassword(parsed.data.password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Incorrect password', remaining: rateLimit.remaining },
        { status: 401 }
      );
    }

    const token = await createSessionToken();
    const res = NextResponse.json({ success: true, message: 'Logged in successfully' });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    console.error('[API /auth/login] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
