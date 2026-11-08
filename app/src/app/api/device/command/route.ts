import { NextRequest, NextResponse } from 'next/server';
import { verifySession, validateMutationRequest } from '@/lib/auth';
import { mqttService } from '@/lib/mqtt';
import { addHistory } from '@/lib/redis';
import { ApiCommandRequestSchema, DeviceCommand } from '@aavritti/shared';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

function generateCommandId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `c_${ts}_${rand}`;
}

export async function POST(req: NextRequest) {
  if (!validateMutationRequest(req)) {
    return NextResponse.json({ error: 'Forbidden: Missing CSRF headers' }, { status: 403 });
  }

  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawBody = await req.json();
    const parsed = ApiCommandRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid command payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const commandId = generateCommandId();

    const fullCommand: DeviceCommand = {
      v: 1,
      id: commandId,
      ...input,
    } as DeviceCommand;

    // Record play events to history
    if (fullCommand.type === 'play') {
      addHistory({
        station: fullCommand.name || 'Station',
        url: fullCommand.url,
        playedAt: Date.now(),
        kbps: fullCommand.kbps,
      }).catch((e) => console.error('[API /device/command] Error saving history:', e));
    }

    // Publish to broker and wait up to 3s for device "received" ack
    const res = await mqttService.publishCommand(fullCommand);

    return NextResponse.json(res);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('MQTT_AUTH_FAILED')) {
      return NextResponse.json(
        { error: 'MQTT Broker authentication failed' },
        { status: 503 }
      );
    }
    console.error('[API /device/command] Error:', err);
    return NextResponse.json({ error: 'Failed to send command to device' }, { status: 500 });
  }
}
