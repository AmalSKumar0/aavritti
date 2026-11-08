import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { mqttService } from '@/lib/mqtt';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function GET(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stateResponse = await mqttService.getState();
    return NextResponse.json(stateResponse);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('MQTT_AUTH_FAILED')) {
      return NextResponse.json(
        { error: 'MQTT Broker authentication failed. Please verify MQTT_USERNAME and MQTT_PASSWORD.' },
        { status: 503 }
      );
    }
    console.error('[API /device/state] Error:', err);
    return NextResponse.json(
      { error: 'Unable to communicate with MQTT broker' },
      { status: 500 }
    );
  }
}
