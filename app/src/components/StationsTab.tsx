'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StationItem, FavoriteItem } from '@aavritti/shared';
import {
  Search,
  Radio,
  Play,
  Star,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ThumbsUp,
  Volume2,
} from 'lucide-react';

interface StationsTabProps {
  favorites: FavoriteItem[];
  onPlayStation: (station: { url: string; name: string; kbps?: number }) => void;
  onToggleFavorite: (station: StationItem) => void;
}

export function StationsTab({
  favorites,
  onPlayStation,
  onToggleFavorite,
}: StationsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLanguage, setActiveLanguage] = useState('malayalam');

  const {
    data: stations,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['stations', searchQuery, activeLanguage],
    queryFn: () =>
      api.searchStations({
        q: searchQuery,
        language: activeLanguage,
        limit: 30,
      }),
    staleTime: 5 * 60 * 1000,
  });

  const isFavorite = (url: string) => favorites.some((f) => f.url === url);

  return (
    <div className="space-y-4 pb-8">
      {/* Search Input Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stations by name..."
            aria-label="Search radio stations"
            className="w-full pl-10 pr-4 py-3 rounded-2xl bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
          />
        </div>

        {/* Quick Language Pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'malayalam', label: 'Malayalam' },
            { id: 'tamil', label: 'Tamil' },
            { id: 'hindi', label: 'Hindi' },
            { id: '', label: 'All' },
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setActiveLanguage(pill.id)}
              className={`px-3.5 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${
                activeLanguage === pill.id
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'bg-card border border-border text-muted hover:text-foreground'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stations List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Fetching station directory...</p>
        </div>
      ) : isError ? (
        <div className="p-8 text-center rounded-2xl bg-card border border-border">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-muted">Failed to load Radio Browser directory.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium"
          >
            Retry
          </button>
        </div>
      ) : stations?.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-card border border-border text-muted text-sm">
          No stations found matching your query.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {stations?.map((station) => {
            const favorite = isFavorite(station.url_resolved);

            return (
              <div
                key={station.id}
                className="flex items-center justify-between p-4 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all group"
              >
                <div className="flex items-center gap-3.5 min-w-0 pr-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background border border-border text-primary overflow-hidden">
                    {station.favicon ? (
                      <img
                        src={station.favicon}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <Radio className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {station.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {station.esp32Compatible ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>ESP32 OK</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          <span>{station.codec || 'Non-MP3'}</span>
                        </span>
                      )}

                      <span className="text-[11px] text-muted font-mono">
                        {station.bitrate ? `${station.bitrate}k` : 'MP3'}
                      </span>

                      {station.votes > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-muted">
                          <ThumbsUp className="h-2.5 w-2.5" />
                          <span>{station.votes}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onToggleFavorite(station)}
                    aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                    className={`p-2 rounded-xl transition-colors ${
                      favorite
                        ? 'text-amber-400 hover:text-amber-300'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                  </button>

                  <button
                    onClick={() => {
                      onPlayStation({
                        url: station.url_resolved,
                        name: station.name,
                        kbps: station.bitrate,
                      });
                      api.recordStationClick(station.id);
                    }}
                    aria-label={`Play ${station.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-transform active:scale-95 shadow"
                  >
                    <Play className="h-4 w-4 fill-current ml-0.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
