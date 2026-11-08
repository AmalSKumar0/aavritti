import { NextRequest, NextResponse } from 'next/server';
import { verifySession, validateMutationRequest } from '@/lib/auth';
import { getFavorites, saveFavorite, removeFavorite } from '@/lib/redis';
import { FavoriteItemSchema } from '@aavritti/shared';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function GET(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const favorites = await getFavorites();
  return NextResponse.json(favorites);
}

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = FavoriteItemSchema.safeParse({
      ...body,
      addedAt: body.addedAt || Date.now(),
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid favorite payload' }, { status: 400 });
    }

    const updated = await saveFavorite(parsed.data);
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[API /favorites POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const DeleteFavoriteSchema = z.object({
  id: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 });
    }

    const parsed = DeleteFavoriteSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const updated = await removeFavorite(parsed.data.id);
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[API /favorites DELETE] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
