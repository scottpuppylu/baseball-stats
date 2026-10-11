import type { messagingApi, webhook } from "@line/bot-sdk";
export type Message = messagingApi.Message;
export type Event = webhook.Event;
export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}
export interface Env {
  DB: Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ALLOWED_GROUP_IDS: string;
  BOT_OWNER_USER_IDS: string;
  ALLOW_PUBLIC_STATS?: string;
  ENABLE_PUSH?: string;
  DATA_BASE_URL?: string;
  REPLY_LIMIT_PER_MINUTE?: string;
  USER_COOLDOWN_MS?: string;
  PUSH_LIMIT_PER_DAY?: string;
  MONTHLY_PUSH_RECIPIENT_LIMIT?: string;
}
export interface Player {
  name: string;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  wrc_plus: number;
  woba: number;
  bb_pct: number;
  k_pct: number;
  [key: string]: string | number | boolean;
}
export interface Game {
  id: string;
  date: string;
  opponent: string;
  status: string;
  finalScore?: { us: number; opp: number };
  [key: string]: unknown;
}
export interface Snapshot {
  logs: Record<string, unknown>[];
  games: Game[];
  defense: Record<string, string[]>;
  avatars: Record<string, string>;
  guests: Record<string, unknown>[];
  digest: string;
  fetchedAt: number;
  source: string;
}
export interface Lineup {
  items: {
    slot: number;
    player: Player;
    posInfo: { posKey: string; label: string };
    role: string;
    reason: string;
  }[];
  targetSize: number;
  model: {
    runs: number;
    freeRuns: number;
    ignoredLocks: string[];
    cfg: Record<string, unknown>;
  };
}
export interface Career {
  milestones: { date: string; text: string }[];
  streaks: { hit: number; onBase: number; bestHit: number; bestOnBase: number };
  highs: { key: string; value: number; date: string }[];
}
export interface BoxRow {
  name: string;
  slot: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  k: number;
  h2: number;
  h3: number;
}
export interface GameReport {
  summary: { rows: BoxRow[] };
  mvp: { name: string; line: string; tags: string[] } | null;
  records: { marks: string[]; hitStreaks: string[]; onBaseStreaks: string[] };
  scored: boolean;
}
export interface Member {
  group_id: string;
  user_id: string;
  player_key: string;
  name: string;
  role: "player" | "coach" | "admin";
  active: number;
}
export interface Match {
  id: string;
  group_id: string;
  starts: number;
  meet: number;
  deadline: number;
  location: string;
  opponent: string;
  note: string;
  created_by: string;
  reminders: number;
}
export interface Attendance {
  match_id: string;
  user_id: string;
  status: "yes" | "maybe" | "no";
  updated_at: number;
  event_id: string;
  version: number;
  name?: string;
}
export interface Flow {
  id: string;
  group_id: string;
  user_id: string;
  kind: string;
  step: string;
  payload: string;
  version: number;
  expires: number;
}
export interface Context {
  group: string;
  user: string;
  eventId: string;
  timestamp: number;
  replyToken: string;
  role: "guest" | "player" | "coach" | "admin";
  member: Member | null;
  now: number;
}
export interface Transport {
  reply(token: string, messages: Message[]): Promise<void>;
  push(group: string, messages: Message[], retryKey: string): Promise<void>;
  quota(): Promise<{ remaining: number }>;
  memberCount(group: string): Promise<number>;
  profile(group: string, user: string): Promise<string | null>;
}
export interface Dependencies {
  snapshot(): Promise<Snapshot>;
  transport: Transport;
  now?: () => number;
}
