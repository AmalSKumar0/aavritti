import { z } from 'zod';

// ==========================================
// Command Schemas (Backend -> Device)
// ==========================================

export const PlayCommandSchema = z.object({
  v: z.literal(1).default(1),
  id: z.string().min(1),
  type: z.literal('play'),
  url: z.string().url().max(255).refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  }),
  name: z.string().max(80).default('Radio Station'),
  kbps: z.number().int().nonnegative().optional().default(128),
});

export const VolumeCommandSchema = z.object({
  v: z.literal(1).default(1),
  id: z.string().min(1),
  type: z.literal('volume'),
  value: z.number().int().min(0).max(100),
});

export const SimpleActionCommandSchema = z.object({
  v: z.literal(1).default(1),
  id: z.string().min(1),
  type: z.enum(['stop', 'resume', 'reboot', 'ping']),
});

export const SleepCommandSchema = z.object({
  v: z.literal(1).default(1),
  id: z.string().min(1),
  type: z.literal('sleep'),
  minutes: z.number().int().min(0).max(1440), // 0 cancels
});

export const CommandSchema = z.discriminatedUnion('type', [
  PlayCommandSchema,
  VolumeCommandSchema,
  SimpleActionCommandSchema,
  SleepCommandSchema,
]);

export type PlayCommand = z.infer<typeof PlayCommandSchema>;
export type VolumeCommand = z.infer<typeof VolumeCommandSchema>;
export type SimpleActionCommand = z.infer<typeof SimpleActionCommandSchema>;
export type SleepCommand = z.infer<typeof SleepCommandSchema>;
export type DeviceCommand = z.infer<typeof CommandSchema>;

// API request schema (id generated if not provided)
export const ApiCommandRequestSchema = z.union([
  z.object({
    type: z.literal('play'),
    url: z.string().url().max(255),
    name: z.string().max(80).optional(),
    kbps: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('volume'),
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.enum(['stop', 'resume', 'reboot', 'ping']),
  }),
  z.object({
    type: z.literal('sleep'),
    minutes: z.number().int().min(0).max(1440),
  }),
]);

export type ApiCommandRequest = z.infer<typeof ApiCommandRequestSchema>;

// ==========================================
// Ack Schema (Device -> Backend on cmd queue)
// ==========================================

export const AckSchema = z.object({
  id: z.string(),
  status: z.literal('received'),
});

export type DeviceAck = z.infer<typeof AckSchema>;

// ==========================================
// State Schema (Device -> Backend)
// ==========================================

export const PlayerStateEnum = z.enum([
  'idle',
  'connecting',
  'buffering',
  'playing',
  'rebuffering',
  'error',
]);

export type PlayerStateType = z.infer<typeof PlayerStateEnum>;

export const LastCmdResultSchema = z.object({
  id: z.string(),
  status: z.enum(['done', 'failed', 'received']),
  error: z.string().optional(),
  ms: z.number().nonnegative().optional(),
});

export type LastCmdResult = z.infer<typeof LastCmdResultSchema>;

export const DeviceStateSchema = z.object({
  v: z.literal(1).default(1),
  fw: z.string().default('1.0.0'),
  ts: z.number().nonnegative(),
  uptime: z.number().nonnegative(),
  wifi: z.object({
    rssi: z.number(),
  }),
  heap: z.object({
    free: z.number().nonnegative(),
    min: z.number().nonnegative(),
    largest: z.number().nonnegative(),
  }),
  player: z.object({
    state: PlayerStateEnum,
    station: z.string(),
    url: z.string(),
    kbps: z.number().nonnegative(),
    https: z.boolean(),
    bufferPct: z.number().min(0).max(100),
    netKBps: z.number().nonnegative(),
    underruns: z.number().nonnegative(),
    reconnects: z.number().nonnegative(),
    gapMs: z.number().nonnegative(),
    volume: z.number().min(0).max(100),
    sleepIn: z.number().nonnegative().default(0), // minutes remaining
  }),
  lastCmd: LastCmdResultSchema.optional(),
});

export type DeviceState = z.infer<typeof DeviceStateSchema>;

// ==========================================
// Station & Stream Validator Schemas
// ==========================================

export const StationItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  url_resolved: z.string(),
  bitrate: z.number(),
  codec: z.string(),
  favicon: z.string().optional(),
  votes: z.number().optional().default(0),
  esp32Compatible: z.boolean(),
  country: z.string().optional(),
  language: z.string().optional(),
});

export type StationItem = z.infer<typeof StationItemSchema>;

export const StreamCheckResponseSchema = z.object({
  originalUrl: z.string(),
  finalUrl: z.string(),
  isHttps: z.boolean(),
  contentType: z.string(),
  icyName: z.string().optional(),
  icyBitrate: z.number().optional(),
  icyGenre: z.string().optional(),
  compatible: z.boolean(),
  status: z.enum(['ok', 'warning', 'incompatible']),
  notes: z.array(z.string()),
});

export type StreamCheckResponse = z.infer<typeof StreamCheckResponseSchema>;

export const FavoriteItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  bitrate: z.number().default(128),
  favicon: z.string().optional(),
  isCustom: z.boolean().default(false),
  addedAt: z.number(),
});

export type FavoriteItem = z.infer<typeof FavoriteItemSchema>;

export const HistoryItemSchema = z.object({
  station: z.string(),
  url: z.string(),
  playedAt: z.number(),
  kbps: z.number().optional().default(128),
});

export type HistoryItem = z.infer<typeof HistoryItemSchema>;
