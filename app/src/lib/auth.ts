import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const JWT_ALGORITHM = 'HS256';
const COOKIE_NAME = 'aavritti_session';
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || 'fallback-secret-at-least-32-chars-long-security';
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  sub: string;
  role: 'owner';
  iat: number;
  exp: number;
}

// In-memory rate limiting fallback for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
    return { allowed: true, remaining: 4 };
  }

  if (entry.count >= 5) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: 5 - entry.count };
}

export async function createSessionToken(): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({ sub: 'owner', role: 'owner' })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(key);
}

export async function verifySession(req: NextRequest): Promise<SessionPayload | null> {
  const cookie = req.cookies.get(COOKIE_NAME);
  const token = cookie?.value;

  if (!token) {
    // Check Authorization header fallback (useful for testing)
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return verifyTokenString(authHeader.substring(7));
    }
    return null;
  }

  return verifyTokenString(token);
}

export async function verifyTokenString(token: string): Promise<SessionPayload | null> {
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  let hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    return password === 'admin';
  }
  hash = hash.replace(/^['"]|['"]$/g, '').replace(/\\(\$)/g, '$1');
  try {
    return await bcrypt.compare(password, hash);
  } catch (e) {
    console.error('[AUTH ERROR] bcrypt compare error:', e, 'hash was:', hash);
    return false;
  }
}

export function setSessionCookie(res: NextResponse, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Validate mutating requests against CSRF.
 * Requires X-Requested-With header AND checks Origin against APP_ORIGIN / Request Host.
 */
export function validateMutationRequest(req: NextRequest): boolean {
  // 1. Must carry X-Requested-With header
  const xRequestedWith = req.headers.get('x-requested-with');
  if (!xRequestedWith) {
    return false;
  }

  // 2. Validate Origin header
  const origin = req.headers.get('origin');
  if (!origin) {
    return true; // Allow non-browser agents if X-Requested-With is present
  }

  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin && origin === configuredOrigin) {
    return true;
  }

  // Fallback to host check (useful during localhost dev or Vercel preview URLs)
  const host = req.headers.get('host');
  if (host) {
    const originHost = new URL(origin).host;
    if (originHost === host) {
      return true;
    }
  }

  return false;
}
