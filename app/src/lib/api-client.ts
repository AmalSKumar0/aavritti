import {
  DeviceStateResponse,
  DeviceCommandResponse,
  ApiCommandRequest,
  StationItem,
  StreamCheckResponse,
  FavoriteItem,
  HistoryItem,
} from '@aavritti/shared';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET');

  const headers = new Headers(options.headers);
  if (isMutation && !headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (res.status === 401 && endpoint !== '/api/auth/me' && endpoint !== '/api/auth/login') {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed with status ${res.status}`);
  }

  return json as T;
}

export const api = {
  // Auth
  login: (password: string) =>
    request<{ success: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  getMe: () =>
    request<{ authenticated: boolean; user?: string }>('/api/auth/me'),

  // Device
  getDeviceState: () => request<DeviceStateResponse>('/api/device/state'),
  sendCommand: (cmd: ApiCommandRequest) =>
    request<DeviceCommandResponse>('/api/device/command', {
      method: 'POST',
      body: JSON.stringify(cmd),
    }),

  // Stations & Streams
  searchStations: (params: { q?: string; language?: string; limit?: number }) => {
    const qp = new URLSearchParams();
    if (params.q) qp.set('q', params.q);
    if (params.language) qp.set('language', params.language);
    if (params.limit) qp.set('limit', params.limit.toString());
    return request<StationItem[]>(`/api/stations/search?${qp.toString()}`);
  },
  checkStream: (url: string) =>
    request<StreamCheckResponse>('/api/streams/check', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  recordStationClick: (stationuuid: string) =>
    request<{ ok: boolean }>('/api/stations/click', {
      method: 'POST',
      body: JSON.stringify({ stationuuid }),
    }).catch(() => {}),

  // Favorites & History
  getFavorites: () => request<FavoriteItem[]>('/api/favorites'),
  addFavorite: (item: Partial<FavoriteItem>) =>
    request<FavoriteItem[]>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify(item),
    }),
  removeFavorite: (id: string) =>
    request<FavoriteItem[]>(`/api/favorites?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getHistory: () => request<HistoryItem[]>('/api/history'),
};
