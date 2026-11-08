'use client';

import React from 'react';

interface BufferMeterProps {
  bufferPct: number;
}

export function BufferMeter({ bufferPct }: BufferMeterProps) {
  const segments = 10;
  const activeSegments = Math.round((Math.max(0, Math.min(100, bufferPct)) / 100) * segments);

  return (
    <div className="space-y-1.5" aria-label={`Buffer level: ${bufferPct}%`}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Ring Buffer</span>
        <span className="font-mono font-medium text-foreground">{bufferPct}%</span>
      </div>
      <div className="grid grid-cols-10 gap-1 h-2.5">
        {Array.from({ length: segments }).map((_, i) => {
          const isActive = i < activeSegments;
          let color = 'bg-primary';
          if (i < 2) color = 'bg-red-500';
          else if (i < 5) color = 'bg-amber-500';

          return (
            <div
              key={i}
              className={`h-full rounded-sm transition-colors duration-300 ${
                isActive ? color : 'bg-border/60'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
