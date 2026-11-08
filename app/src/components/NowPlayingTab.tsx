'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  DeviceState,
  FavoriteItem,
  ApiCommandRequest,
} from '@aavritti/shared';
import { Equalizer } from './Equalizer';
import { BufferMeter } from './BufferMeter';
import { SleepTimerModal } from './SleepTimerModal';
import {
  Play,
  Square,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Moon,
  Radio,
  Wifi,
  WifiOff,
  Clock,
  Sparkles,
} from 'lucide-react';

interface NowPlayingTabProps {
  deviceState: DeviceState | null;
  isOnline: boolean;
  stale: boolean;
  favorites: FavoriteItem[];
  onSendCommand: (cmd: ApiCommandRequest) => Promise<void>;
  pendingCommandId: string | null;
}

export function NowPlayingTab({
  deviceState,
  isOnline,
  stale,
  favorites,
  onSendCommand,
  pendingCommandId,
}: NowPlayingTabProps) {
  const player = deviceState?.player;
  const isPlaying = player?.state === 'playing';
  const isBuffering = player?.state === 'buffering' || player?.state === 'connecting' || player?.state === 'rebuffering';

  // Optimistic volume state
  const [volume, setVolume] = useState<number>(player?.volume ?? 35);
  const [isDraggingVol, setIsDraggingVol] = useState(false);
  const volumeDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Sync volume when remote state changes (if not actively dragging)
  useEffect(() => {
    if (!isDraggingVol && player?.volume !== undefined) {
      setVolume(player.volume);
    }
  }, [player?.volume, isDraggingVol]);

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsDraggingVol(true);

    if (volumeDebounceTimer.current) {
      clearTimeout(volumeDebounceTimer.current);
    }

    volumeDebounceTimer.current = setTimeout(async () => {
      setIsDraggingVol(false);
      try {
        await onSendCommand({ type: 'volume', value: newVol });
      } catch {
        // Snap back on failure
        if (player?.volume !== undefined) {
          setVolume(player.volume);
        }
      }
    }, 300);
  };

  // Next / Previous Station cycle through favorites
  const handlePrevStation = () => {
    if (favorites.length === 0) return;
    const currentUrl = player?.url || '';
    const currentIndex = favorites.findIndex((f) => f.url === currentUrl);
    const prevIndex = currentIndex <= 0 ? favorites.length - 1 : currentIndex - 1;
    const target = favorites[prevIndex];
    onSendCommand({
      type: 'play',
      url: target.url,
      name: target.name,
      kbps: target.bitrate,
    });
  };

  const handleNextStation = () => {
    if (favorites.length === 0) return;
    const currentUrl = player?.url || '';
    const currentIndex = favorites.findIndex((f) => f.url === currentUrl);
    const nextIndex = currentIndex < 0 || currentIndex >= favorites.length - 1 ? 0 : currentIndex + 1;
    const target = favorites[nextIndex];
    onSendCommand({
      type: 'play',
      url: target.url,
      name: target.name,
      kbps: target.bitrate,
    });
  };

  // Sleep Timer Modal
  const [sleepModalOpen, setSleepModalOpen] = useState(false);

  // State Badge text and color
  const getStateBadge = () => {
    if (!isOnline) {
      return { text: 'Device Offline', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
    }
    if (stale) {
      return { text: 'State Stale', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    }
    switch (player?.state) {
      case 'playing':
        return { text: 'Playing', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'buffering':
        return { text: 'Buffering', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
      case 'connecting':
        return { text: 'Connecting', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
      case 'rebuffering':
        return { text: 'Re-buffering', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      case 'error':
        return { text: 'Stream Error', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
      default:
        return { text: 'Idle', color: 'bg-muted/10 text-muted border-border' };
    }
  };

  const stateBadge = getStateBadge();

  return (
    <div className="space-y-5 pb-6">
      {/* Radio Player Card */}
      <div className="rounded-3xl bg-card border border-border p-6 sm:p-8 shadow-xl relative overflow-hidden">
        {/* Subtle decorative background glow */}
        <div
          className={`absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl pointer-events-none transition-opacity duration-700 ${
            isPlaying ? 'bg-primary/15 opacity-100' : 'bg-primary/5 opacity-40'
          }`}
        />

        {/* Header: Device Status & Equalizer */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${stateBadge.color}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-current opacity-70'
                }`}
              />
              {stateBadge.text}
            </span>

            {player?.https && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-background/80 text-muted border border-border">
                HTTPS
              </span>
            )}
            {player?.kbps ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-background/80 text-muted border border-border">
                {player.kbps} kbps
              </span>
            ) : null}
          </div>

          <Equalizer isPlaying={isPlaying} />
        </div>

        {/* Station Name & Art */}
        <div className="flex items-start gap-4 mb-8">
          <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 text-primary shadow-inner">
            <Radio className="h-8 w-8 sm:h-10 sm:w-10" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {player?.station || 'Aavritti Radio'}
            </h2>
            <p className="text-xs sm:text-sm text-muted truncate mt-1 font-mono">
              {player?.url || 'Ready to stream'}
            </p>
            {player?.sleepIn ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-primary font-medium mt-2 bg-primary/10 px-2.5 py-0.5 rounded-full">
                <Moon className="h-3 w-3" />
                <span>Turns off in {player.sleepIn}m</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Segmented Ring Buffer Meter */}
        <div className="mb-8">
          <BufferMeter bufferPct={player?.bufferPct ?? 0} />
        </div>

        {/* Main Playback Control Bar */}
        <div className="flex items-center justify-center gap-4 sm:gap-6 mb-8">
          <button
            onClick={handlePrevStation}
            disabled={favorites.length === 0}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background border border-border text-foreground hover:bg-border/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
            aria-label="Previous station in favorites"
          >
            <SkipBack className="h-5 w-5" />
          </button>

          <button
            onClick={() => {
              if (isPlaying) {
                onSendCommand({ type: 'stop' });
              } else {
                onSendCommand({ type: 'resume' });
              }
            }}
            disabled={!isOnline}
            className={`flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-3xl text-white shadow-lg transition-all active:scale-95 ${
              isPlaying
                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                : 'bg-primary hover:bg-primary/90 shadow-primary/25'
            } ${pendingCommandId ? 'opacity-80 animate-pulse' : ''}`}
            aria-label={isPlaying ? 'Stop playback' : 'Resume playback'}
          >
            {isPlaying ? (
              <Square className="h-7 w-7 sm:h-8 sm:w-8 fill-current" />
            ) : (
              <Play className="h-7 w-7 sm:h-8 sm:w-8 fill-current ml-1" />
            )}
          </button>

          <button
            onClick={handleNextStation}
            disabled={favorites.length === 0}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background border border-border text-foreground hover:bg-border/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
            aria-label="Next station in favorites"
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>

        {/* Big Volume Control */}
        <div className="rounded-2xl bg-background/60 border border-border/80 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              {volume === 0 ? (
                <VolumeX className="h-4 w-4 text-muted" />
              ) : volume < 50 ? (
                <Volume1 className="h-4 w-4 text-primary" />
              ) : (
                <Volume2 className="h-4 w-4 text-primary" />
              )}
              <span>Volume</span>
            </div>
            <span className="font-mono text-sm font-semibold">{volume}%</span>
          </div>

          <div className="relative flex items-center">
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10))}
              aria-label="Volume slider"
              className="w-full h-3 bg-border rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
            />
          </div>

          {/* Quick Volume Preset Buttons */}
          <div className="flex items-center justify-between gap-1.5 pt-1">
            {[0, 25, 50, 75, 100].map((v) => (
              <button
                key={v}
                onClick={() => handleVolumeChange(v)}
                className={`flex-1 py-1 px-2 rounded-lg text-xs font-mono transition-colors ${
                  volume === v
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'bg-background hover:bg-border/60 text-muted'
                }`}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>

        {/* Footer Actions: Sleep Timer & Quick Details */}
        <div className="flex items-center justify-between mt-6 pt-5 border-t border-border/80 text-xs text-muted">
          <button
            onClick={() => setSleepModalOpen(true)}
            className="flex items-center gap-2 py-2 px-3 rounded-xl bg-background border border-border hover:border-primary/40 text-foreground transition-colors"
          >
            <Moon className="h-4 w-4 text-primary" />
            <span>
              {player?.sleepIn ? `Sleep in ${player.sleepIn}m` : 'Sleep Timer'}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 font-mono">
              <Clock className="h-3.5 w-3.5" />
              <span>{player?.gapMs ? `${player.gapMs}ms gap` : '0ms gap'}</span>
            </div>
            <div className="flex items-center gap-1">
              {isOnline ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-red-400" />
              )}
              <span>{deviceState?.wifi.rssi ? `${deviceState.wifi.rssi} dBm` : 'NAT Outbound'}</span>
            </div>
          </div>
        </div>
      </div>

      <SleepTimerModal
        isOpen={sleepModalOpen}
        onClose={() => setSleepModalOpen(false)}
        onSetTimer={(min) => onSendCommand({ type: 'sleep', minutes: min })}
        currentSleepIn={player?.sleepIn ?? 0}
      />
    </div>
  );
}
