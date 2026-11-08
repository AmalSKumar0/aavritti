'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api-client';
import { StreamCheckResponse } from '@aavritti/shared';
import {
  Link as LinkIcon,
  Search,
  Play,
  Star,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Info,
  ShieldCheck,
} from 'lucide-react';

interface AddStreamTabProps {
  onPlayStream: (stream: { url: string; name: string; kbps?: number }) => void;
  onSaveFavorite: (stream: { url: string; name: string; bitrate: number; isCustom: boolean }) => void;
}

export function AddStreamTab({ onPlayStream, onSaveFavorite }: AddStreamTabProps) {
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<StreamCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setChecking(true);
    setError(null);
    setReport(null);
    setSavedSuccess(false);

    try {
      const data = await api.checkStream(url.trim());
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to inspect stream';
      setError(msg);
    } finally {
      setChecking(false);
    }
  };

  const streamName = report?.icyName || 'Custom Stream';
  const bitrate = report?.icyBitrate || 128;

  return (
    <div className="space-y-6 pb-8">
      {/* Intro info banner */}
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 flex items-start gap-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="text-xs sm:text-sm text-muted">
          <p className="font-semibold text-foreground mb-0.5">
            SSRF-Safe Stream Inspector
          </p>
          <p>
            Paste any HTTP or HTTPS radio stream link. Vercel inspects the stream headers safely without downloading the audio. The ESP32 connects directly to the audio server.
          </p>
        </div>
      </div>

      {/* URL Input Form */}
      <form onSubmit={handleCheck} className="space-y-3">
        <label htmlFor="stream-url" className="text-xs font-semibold uppercase tracking-wider text-muted block">
          Stream URL (HTTP or HTTPS)
        </label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted">
              <LinkIcon className="h-4 w-4" />
            </div>
            <input
              id="stream-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/stream.mp3"
              required
              aria-label="Stream URL"
              className="w-full pl-10 pr-4 py-3 rounded-2xl bg-card border border-border text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={checking || !url.trim()}
            className="flex items-center justify-center gap-2 py-3 px-6 rounded-2xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                <span>Check Stream</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400 flex items-start gap-3"
        >
          <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Stream Check Failed</p>
            <p className="text-xs text-red-300/90 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Inspection Results Card */}
      {report && (
        <div className="rounded-2xl bg-card border border-border p-6 shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                    report.status === 'ok'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : report.status === 'warning'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}
                >
                  {report.status === 'ok' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : report.status === 'warning' ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {report.status === 'ok'
                      ? 'Compatible with ESP32'
                      : report.status === 'warning'
                      ? 'Warning: Review Compatibility'
                      : 'Incompatible Format'}
                  </span>
                </span>
              </div>
              <h3 className="text-lg font-bold text-foreground mt-2">{streamName}</h3>
              <p className="text-xs text-muted font-mono break-all mt-1">{report.finalUrl}</p>
            </div>
          </div>

          {/* Metadata Specs Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-background p-3 border border-border">
              <span className="text-[11px] text-muted uppercase font-semibold">Content-Type</span>
              <p className="text-sm font-mono font-medium text-foreground truncate mt-0.5">
                {report.contentType}
              </p>
            </div>
            <div className="rounded-xl bg-background p-3 border border-border">
              <span className="text-[11px] text-muted uppercase font-semibold">Bitrate</span>
              <p className="text-sm font-mono font-medium text-foreground mt-0.5">
                {report.icyBitrate ? `${report.icyBitrate} kbps` : '128 kbps (est)'}
              </p>
            </div>
            <div className="rounded-xl bg-background p-3 border border-border">
              <span className="text-[11px] text-muted uppercase font-semibold">Protocol</span>
              <p className="text-sm font-mono font-medium text-foreground mt-0.5">
                {report.isHttps ? 'HTTPS (TLS)' : 'HTTP (Plain)'}
              </p>
            </div>
            <div className="rounded-xl bg-background p-3 border border-border">
              <span className="text-[11px] text-muted uppercase font-semibold">Genre</span>
              <p className="text-sm font-medium text-foreground truncate mt-0.5">
                {report.icyGenre || 'Malayalam / Music'}
              </p>
            </div>
          </div>

          {/* Notes & Alerts */}
          {report.notes.length > 0 && (
            <div className="space-y-1.5 text-xs text-muted">
              {report.notes.map((note, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() =>
                onPlayStream({
                  url: report.finalUrl,
                  name: streamName,
                  kbps: bitrate,
                })
              }
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-all shadow-md active:scale-[0.99]"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Play Now on ESP32</span>
            </button>

            <button
              onClick={() => {
                onSaveFavorite({
                  url: report.finalUrl,
                  name: streamName,
                  bitrate,
                  isCustom: true,
                });
                setSavedSuccess(true);
                setTimeout(() => setSavedSuccess(false), 3000);
              }}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-background border border-border hover:border-primary/50 text-foreground font-medium text-sm transition-colors"
            >
              <Star className="h-4 w-4 text-amber-400" />
              <span>{savedSuccess ? 'Saved to Favorites!' : 'Save to Favorites'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
