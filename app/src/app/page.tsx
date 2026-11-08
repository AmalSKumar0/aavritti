'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Navigation, TabType } from '@/components/Navigation';
import { NowPlayingTab } from '@/components/NowPlayingTab';
import { StationsTab } from '@/components/StationsTab';
import { AddStreamTab } from '@/components/AddStreamTab';
import { DeviceTab } from '@/components/DeviceTab';
import {
  StationItem,
  FavoriteItem,
  ApiCommandRequest,
} from '@aavritti/shared';
import {
  AlertCircle,
  WifiOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Volume2,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabType>('now-playing');
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [fastPollingUntil, setFastPollingUntil] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Authentication check
  const { data: me, isLoading: authLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
    retry: false,
  });

  useEffect(() => {
    if (!authLoading && !me?.authenticated) {
      router.push('/login');
    }
  }, [authLoading, me, router]);

  // Adaptive Polling Interval calculation
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isBrowserOnline, setIsBrowserOnline] = useState(true);

  useEffect(() => {
    const handleVisibility = () => {
      setIsWindowVisible(document.visibilityState === 'visible');
    };
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getPollingInterval = () => {
    if (!isBrowserOnline) return false; // Paused when browser is offline
    const now = Date.now();
    if (now < fastPollingUntil) return 1000; // 1s for 15s post-command
    if (!isWindowVisible) return 15000; // 15s when tab is hidden
    return 3000; // 3s while visible
  };

  // Device State Query with adaptive refetchInterval
  const { data: deviceStateResponse, isLoading: stateLoading } = useQuery({
    queryKey: ['device-state'],
    queryFn: () => api.getDeviceState(),
    refetchInterval: getPollingInterval(),
  });

  // Favorites Query
  const { data: favorites = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api.getFavorites(),
  });

  // Track pending command completion against state.lastCmd
  const lastProcessedCmdId = useRef<string | null>(null);

  useEffect(() => {
    const lastCmd = deviceStateResponse?.state?.lastCmd;
    if (lastCmd && pendingCommandId && lastCmd.id === pendingCommandId) {
      if (lastProcessedCmdId.current !== lastCmd.id) {
        lastProcessedCmdId.current = lastCmd.id;
        setPendingCommandId(null);

        if (lastCmd.status === 'done') {
          showToast('success', `Command applied successfully (${lastCmd.ms || 0}ms)`);
        } else if (lastCmd.status === 'failed') {
          showToast('error', `Command failed: ${lastCmd.error || 'Device error'}`);
        }
      }
    }
  }, [deviceStateResponse, pendingCommandId]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Command mutation
  const commandMutation = useMutation({
    mutationFn: (cmd: ApiCommandRequest) => api.sendCommand(cmd),
    onSuccess: (data) => {
      setPendingCommandId(data.id);
      // Trigger aggressive 1s polling for 15 seconds
      setFastPollingUntil(Date.now() + 15000);
      queryClient.invalidateQueries({ queryKey: ['device-state'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to send command';
      showToast('error', msg);
    },
  });

  const handleSendCommand = async (cmd: ApiCommandRequest) => {
    await commandMutation.mutateAsync(cmd);
  };

  // Favorites mutations
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (station: StationItem) => {
      const isFav = favorites.some((f) => f.url === station.url_resolved);
      if (isFav) {
        const item = favorites.find((f) => f.url === station.url_resolved);
        if (item) await api.removeFavorite(item.id);
      } else {
        await api.addFavorite({
          id: station.id,
          name: station.name,
          url: station.url_resolved,
          bitrate: station.bitrate,
          favicon: station.favicon,
          isCustom: false,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const saveCustomFavoriteMutation = useMutation({
    mutationFn: (item: { url: string; name: string; bitrate: number; isCustom: boolean }) =>
      api.addFavorite({
        id: `fav_${Date.now()}`,
        name: item.name,
        url: item.url,
        bitrate: item.bitrate,
        isCustom: item.isCustom,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      showToast('success', 'Saved stream to favorites');
    },
  });

  const handleLogout = async () => {
    try {
      await api.logout();
      router.push('/login');
    } catch {
      router.push('/login');
    }
  };

  if (authLoading || !me?.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isOnline = deviceStateResponse?.online ?? false;
  const isStale = deviceStateResponse?.stale ?? false;
  const deviceState = deviceStateResponse?.state ?? null;

  return (
    <div className="min-h-screen flex flex-col pb-20 md:pb-8">
      {/* Top Header / Desktop Nav */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLogout={handleLogout}
        isOnline={isOnline}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 pt-5">
        {/* Offline / Stale Alert Banner */}
        {(!isOnline || isStale) && (
          <div
            role="alert"
            className={`rounded-2xl p-4 mb-5 flex items-center justify-between text-xs sm:text-sm border transition-colors ${
              !isOnline
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {!isOnline ? (
                <WifiOff className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {!isOnline
                  ? 'ESP32 Radio is currently offline (Last Will received). Verify power and home Wi-Fi.'
                  : `Radio state may be stale (${Math.round((deviceStateResponse?.ageMs || 0) / 1000)}s old). Reconnecting...`}
              </span>
            </div>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['device-state'] })}
              className="px-3 py-1 rounded-lg bg-background/80 hover:bg-background border border-current text-xs font-medium shrink-0 ml-2"
            >
              Refresh
            </button>
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div
            role="status"
            className={`fixed top-20 right-4 z-50 rounded-2xl p-4 shadow-2xl flex items-center gap-2.5 text-sm border animate-in slide-in-from-top-3 duration-200 ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
                : 'bg-red-950/90 text-red-200 border-red-500/40'
            }`}
          >
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
            <span>{toastMessage.text}</span>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'now-playing' && (
          <NowPlayingTab
            deviceState={deviceState}
            isOnline={isOnline}
            stale={isStale}
            favorites={favorites}
            onSendCommand={handleSendCommand}
            pendingCommandId={pendingCommandId}
          />
        )}

        {activeTab === 'stations' && (
          <StationsTab
            favorites={favorites}
            onPlayStation={(st) => {
              handleSendCommand({
                type: 'play',
                url: st.url,
                name: st.name,
                kbps: st.kbps,
              });
              setActiveTab('now-playing');
            }}
            onToggleFavorite={(st) => toggleFavoriteMutation.mutate(st)}
          />
        )}

        {activeTab === 'add-stream' && (
          <AddStreamTab
            onPlayStream={(st) => {
              handleSendCommand({
                type: 'play',
                url: st.url,
                name: st.name,
                kbps: st.kbps,
              });
              setActiveTab('now-playing');
            }}
            onSaveFavorite={(st) => saveCustomFavoriteMutation.mutate(st)}
          />
        )}

        {activeTab === 'device' && (
          <DeviceTab
            deviceState={deviceState}
            isOnline={isOnline}
            onSendCommand={handleSendCommand}
            pendingCommandId={pendingCommandId}
          />
        )}
      </main>
    </div>
  );
}
