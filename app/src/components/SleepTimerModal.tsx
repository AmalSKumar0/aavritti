'use client';

import React, { useState } from 'react';
import { Moon, X, Clock } from 'lucide-react';

interface SleepTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetTimer: (minutes: number) => void;
  currentSleepIn: number;
}

export function SleepTimerModal({
  isOpen,
  onClose,
  onSetTimer,
  currentSleepIn,
}: SleepTimerModalProps) {
  const [customMinutes, setCustomMinutes] = useState('45');

  if (!isOpen) return null;

  const presets = [15, 30, 60, 90];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sleep-timer-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Moon className="h-5 w-5" />
            </div>
            <div>
              <h2 id="sleep-timer-title" className="font-semibold text-base">
                Sleep Timer
              </h2>
              {currentSleepIn > 0 && (
                <p className="text-xs text-primary font-medium">
                  Active: turns off in ~{currentSleepIn}m
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 py-5">
          {presets.map((min) => (
            <button
              key={min}
              onClick={() => {
                onSetTimer(min);
                onClose();
              }}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-background border border-border hover:border-primary/50 text-sm font-medium transition-all active:scale-95"
            >
              <Clock className="h-4 w-4 text-muted" />
              <span>{min} Minutes</span>
            </button>
          ))}
        </div>

        <div className="space-y-3 pt-2 pb-5 border-t border-border">
          <label htmlFor="custom-timer" className="text-xs text-muted block">
            Custom duration (minutes)
          </label>
          <div className="flex gap-2">
            <input
              id="custom-timer"
              type="number"
              min="1"
              max="720"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="e.g. 45"
            />
            <button
              onClick={() => {
                const val = parseInt(customMinutes, 10);
                if (!isNaN(val) && val > 0) {
                  onSetTimer(val);
                  onClose();
                }
              }}
              className="py-2.5 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              Set
            </button>
          </div>
        </div>

        {currentSleepIn > 0 && (
          <button
            onClick={() => {
              onSetTimer(0);
              onClose();
            }}
            className="w-full py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors border border-red-500/20"
          >
            Cancel Active Timer
          </button>
        )}
      </div>
    </div>
  );
}
