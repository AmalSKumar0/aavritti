import { NextResponse } from 'next/server';
import { mqttService } from '@/lib/mqtt';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const preferredRegion = 'iad1';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    mqtt: mqttService.isConnected(),
    timestamp: Date.now(),
  });
}
