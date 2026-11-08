'use client';

import React from 'react';

interface EqualizerProps {
  isPlaying: boolean;
}

export function Equalizer({ isPlaying }: EqualizerProps) {
  return (
    <div
      className="flex items-end justify-center gap-1.5 h-8 w-12"
      aria-label={isPlaying ? 'Audio playing equalizer' : 'Equalizer stopped'}
    >
      <span
        className={`w-1.5 rounded-full bg-primary transition-all duration-300 ${
          isPlaying ? 'animate-equalizer1' : 'h-1.5 opacity-40'
        }`}
      />
      <span
        className={`w-1.5 rounded-full bg-primary transition-all duration-300 ${
          isPlaying ? 'animate-equalizer2' : 'h-2 opacity-40'
        }`}
      />
      <span
        className={`w-1.5 rounded-full bg-primary transition-all duration-300 ${
          isPlaying ? 'animate-equalizer3' : 'h-1.5 opacity-40'
        }`}
      />
      <span
        className={`w-1.5 rounded-full bg-primary transition-all duration-300 ${
          isPlaying ? 'animate-equalizer4' : 'h-2.5 opacity-40'
        }`}
      />
    </div>
  );
}
