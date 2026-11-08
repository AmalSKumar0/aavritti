import { Redis } from '@upstash/redis';
import { FavoriteItem, HistoryItem } from '@aavritti/shared';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

const FAVORITES_KEY = 'aavritti:favorites';
const HISTORY_KEY = 'aavritti:history';

// Default Malayalam stations for initial out-of-the-box experience
const DEFAULT_FAVORITES: FavoriteItem[] = [
  {
    id: 'fav-1',
    name: 'Radio City Malayalam',
    url: 'https://stream.zeno.fm/f1q8q86n02quv',
    bitrate: 128,
    isCustom: false,
    addedAt: Date.now() - 100000,
  },
  {
    id: 'fav-2',
    name: 'Club FM Kerala',
    url: 'https://stream.zeno.fm/4p883e4sm0hvv',
    bitrate: 128,
    isCustom: false,
    addedAt: Date.now() - 90000,
  },
  {
    id: 'fav-3',
    name: 'AIR Malayalam (Kochi)',
    url: 'https://air.pc.cdn.bitgravity.com/air/live/pbaudio070/playlist.m3u8',
    bitrate: 96,
    isCustom: false,
    addedAt: Date.now() - 80000,
  },
  {
    id: 'fav-4',
    name: 'Malayalam Hits Live',
    url: 'http://stream.zeno.fm/4w983e4sm0hvv',
    bitrate: 128,
    isCustom: true,
    addedAt: Date.now() - 70000,
  },
];

// In-memory fallback stores
let memoryFavorites: FavoriteItem[] = [...DEFAULT_FAVORITES];
let memoryHistory: HistoryItem[] = [];

export async function getFavorites(): Promise<FavoriteItem[]> {
  if (redis) {
    try {
      const data = await redis.get<FavoriteItem[]>(FAVORITES_KEY);
      if (Array.isArray(data)) return data;
      // Initialize if empty
      await redis.set(FAVORITES_KEY, DEFAULT_FAVORITES);
      return DEFAULT_FAVORITES;
    } catch (e) {
      console.warn('[REDIS] Fallback to memory for favorites:', e);
    }
  }
  return memoryFavorites;
}

export async function saveFavorite(item: FavoriteItem): Promise<FavoriteItem[]> {
  const current = await getFavorites();
  const existingIndex = current.findIndex((f) => f.id === item.id || f.url === item.url);

  let updated: FavoriteItem[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = { ...updated[existingIndex], ...item };
  } else {
    updated = [item, ...current];
  }

  if (redis) {
    try {
      await redis.set(FAVORITES_KEY, updated);
    } catch (e) {
      console.warn('[REDIS] Error saving favorite:', e);
    }
  }
  memoryFavorites = updated;
  return updated;
}

export async function removeFavorite(id: string): Promise<FavoriteItem[]> {
  const current = await getFavorites();
  const updated = current.filter((f) => f.id !== id && f.url !== id);

  if (redis) {
    try {
      await redis.set(FAVORITES_KEY, updated);
    } catch (e) {
      console.warn('[REDIS] Error removing favorite:', e);
    }
  }
  memoryFavorites = updated;
  return updated;
}

export async function getHistory(): Promise<HistoryItem[]> {
  if (redis) {
    try {
      const list = await redis.lrange<HistoryItem>(HISTORY_KEY, 0, 49);
      if (Array.isArray(list)) return list;
    } catch (e) {
      console.warn('[REDIS] Fallback to memory for history:', e);
    }
  }
  return memoryHistory;
}

export async function addHistory(item: HistoryItem): Promise<void> {
  if (redis) {
    try {
      await redis.lpush(HISTORY_KEY, item);
      await redis.ltrim(HISTORY_KEY, 0, 49); // Keep last 50 plays
    } catch (e) {
      console.warn('[REDIS] Error adding history:', e);
    }
  }
  memoryHistory = [item, ...memoryHistory.slice(0, 49)];
}
