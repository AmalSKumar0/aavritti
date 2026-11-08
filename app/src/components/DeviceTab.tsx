'use client';

import React, { useState } from 'react';
import { DeviceState, ApiCommandRequest } from '@aavritti/shared';
import {
  Cpu,
  Wifi,
  HardDrive,
  Activity,
  RotateCcw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Radio,
  ArrowUpDown,
  Loader2,
} from 'lucide-react';

interface DeviceTabProps {
  deviceState: DeviceState | null;
  isOnline: boolean;
  onSendCommand: (cmd: ApiCommandRequest) => Promise<void>;
  pendingCommandId: string | null;
}

export function DeviceTab({
  deviceState,
  isOnline,
  onSendCommand,
  pendingCommandId,
}: DeviceTabProps) {
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  const heap = deviceState?.heap;
  const freeHeap = heap?.free ?? 0;
  const minHeap = heap?.min ?? 0;
  const largestBlock = heap?.largest ?? 0;

  // Heap threshold safety check (> 25 KB target)
  const isHeapSafe = freeHeap >= 25600;

  // Format uptime
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hrs = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (days > 0) return `${days}d ${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    const t0 = performance.now();
    try {
      await onSendCommand({ type: 'ping' });
      const elapsed = Math.round(performance.now() - t0);
      setPingResult(`Round-trip MQTT latency: ~${elapsed}ms`);
    } catch {
      setPingResult('Ping timed out');
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Device Architecture Card */}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">ESP32-WROOM-32</h2>
              <div className="flex items-center gap-2 text-xs text-muted font-mono mt-0.5">
                <span>FW v{deviceState?.fw || '1.0.0'}</span>
                <span>•</span>
                <span>MAX98357A I2S</span>
                <span>•</span>
                <span className="text-primary">NO PSRAM</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePing}
              disabled={!isOnline || pinging}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-background border border-border hover:border-primary/50 text-xs font-medium text-foreground transition-colors disabled:opacity-50"
            >
              {pinging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-primary" />}
              <span>Ping</span>
            </button>

            <button
              onClick={() => setRebootDialogOpen(true)}
              disabled={!isOnline}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reboot</span>
            </button>
          </div>
        </div>

        {pingResult && (
          <div className="mt-4 p-2.5 rounded-xl bg-primary/10 text-primary text-xs font-mono text-center">
            {pingResult}
          </div>
        )}

        {/* Heap Budget & Margin Gauge */}
        <div className="pt-6 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted">
              <HardDrive className="h-4 w-4 text-primary" />
              <span>SRAM Heap Budget & Margin</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                isHeapSafe ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isHeapSafe ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              <span>{isHeapSafe ? 'Safe Margin (>25 KB)' : 'Caution: Low Margin'}</span>
            </span>
          </div>

          {/* Heap Pressure Bar */}
          <div className="space-y-1.5">
            <div className="h-3 rounded-full bg-background border border-border p-0.5 overflow-hidden flex">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isHeapSafe ? 'bg-primary' : 'bg-amber-500'
                }`}
                style={{ width: `${Math.min(100, (freeHeap / 80000) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted font-mono">
              <span>0 KB</span>
              <span>Target: &gt;25 KB</span>
              <span>80 KB Free</span>
            </div>
          </div>

          {/* Heap Metrics Grid */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl bg-background p-3.5 border border-border text-center">
              <span className="text-[11px] text-muted uppercase font-semibold">Free Heap</span>
              <p className="text-base sm:text-lg font-mono font-bold text-foreground mt-1">
                {(freeHeap / 1024).toFixed(1)} KB
              </p>
              <span className="text-[10px] text-muted font-mono">{freeHeap} B</span>
            </div>

            <div className="rounded-xl bg-background p-3.5 border border-border text-center">
              <span className="text-[11px] text-muted uppercase font-semibold">Min Heap (Watermark)</span>
              <p className="text-base sm:text-lg font-mono font-bold text-foreground mt-1">
                {(minHeap / 1024).toFixed(1)} KB
              </p>
              <span className="text-[10px] text-muted font-mono">{minHeap} B</span>
            </div>

            <div className="rounded-xl bg-background p-3.5 border border-border text-center">
              <span className="text-[11px] text-muted uppercase font-semibold">Largest Block</span>
              <p className="text-base sm:text-lg font-mono font-bold text-foreground mt-1">
                {(largestBlock / 1024).toFixed(1)} KB
              </p>
              <span className="text-[10px] text-muted font-mono">{largestBlock} B</span>
            </div>
          </div>
        </div>
      </div>

      {/* Network & Audio Performance Diagnostics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted text-xs">
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span>Wi-Fi Signal</span>
          </div>
          <p className="text-xl font-bold font-mono text-foreground mt-2">
            {deviceState?.wifi.rssi ?? -60} dBm
          </p>
          <span className="text-[11px] text-muted">
            {(deviceState?.wifi.rssi ?? -60) > -65 ? 'Excellent' : 'Fair / Stable'}
          </span>
        </div>

        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted text-xs">
            <ArrowUpDown className="h-4 w-4 text-primary" />
            <span>Throughput</span>
          </div>
          <p className="text-xl font-bold font-mono text-foreground mt-2">
            {deviceState?.player.netKBps ?? 0} KB/s
          </p>
          <span className="text-[11px] text-muted">Direct Station Stream</span>
        </div>

        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted text-xs">
            <Activity className="h-4 w-4 text-amber-400" />
            <span>Underruns</span>
          </div>
          <p className="text-xl font-bold font-mono text-foreground mt-2">
            {deviceState?.player.underruns ?? 0}
          </p>
          <span className="text-[11px] text-muted">Decoder Starvations</span>
        </div>

        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted text-xs">
            <Clock className="h-4 w-4 text-blue-400" />
            <span>Uptime</span>
          </div>
          <p className="text-xl font-bold font-mono text-foreground mt-2">
            {formatUptime(deviceState?.uptime ?? 0)}
          </p>
          <span className="text-[11px] text-muted">Continuous Operation</span>
        </div>
      </div>

      {/* Additional Stats Card */}
      <div className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Operational Statistics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div>
            <span className="text-muted block">Reconnections:</span>
            <span className="font-semibold text-foreground">{deviceState?.player.reconnects ?? 0}</span>
          </div>
          <div>
            <span className="text-muted block">Max Buffer Gap:</span>
            <span className="font-semibold text-foreground">{deviceState?.player.gapMs ?? 0} ms</span>
          </div>
          <div>
            <span className="text-muted block">Active Station Bitrate:</span>
            <span className="font-semibold text-foreground">{deviceState?.player.kbps ?? 128} kbps</span>
          </div>
          <div>
            <span className="text-muted block">Clean Session:</span>
            <span className="font-semibold text-emerald-400">false (Persistent)</span>
          </div>
          <div>
            <span className="text-muted block">MQTT Keepalive:</span>
            <span className="font-semibold text-foreground">30 s</span>
          </div>
          <div>
            <span className="text-muted block">Last Command Status:</span>
            <span className="font-semibold text-foreground">
              {deviceState?.lastCmd?.status || 'none'}
              {deviceState?.lastCmd?.ms ? ` (${deviceState.lastCmd.ms}ms)` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Confirm Reboot Dialog */}
      {rebootDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-foreground">Reboot ESP32 Radio?</h3>
            <p className="text-xs text-muted mt-2">
              The radio stream will stop and the device will restart. It will automatically reconnect to Wi-Fi and MQTT within ~5 seconds.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setRebootDialogOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-background border border-border text-foreground text-xs font-medium hover:bg-border/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setRebootDialogOpen(false);
                  onSendCommand({ type: 'reboot' });
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors shadow"
              >
                Yes, Reboot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
