import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createBot } from "../src/app";
import { localDatabase } from "../src/local-db";
import { digest, engine, playerKey } from "../src/source";
import type {
  Env,
  Message,
  Snapshot,
  Event,
  Transport,
  Match,
} from "../src/types";
export const group = "C" + "1".repeat(32),
  otherGroup = "C" + "2".repeat(32),
  owner = "U" + "a".repeat(32),
  alice = "U" + "b".repeat(32),
  bob = "U" + "c".repeat(32);
export function snapshot(): Snapshot {
  const value = (n: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../tests/fixtures/data/${n}.json`, import.meta.url),
        "utf8",
      ),
    );
  const data = {
    logs: value("logs"),
    games: value("games"),
    defense: value("defense"),
    avatars: value("avatars"),
    guests: [],
  };
  return {
    ...data,
    digest: digest(data),
    fetchedAt: Date.now(),
    source: "isolated-fixtures",
  };
}
export function actions(message: Message) {
  const result: { type: string; label?: string; data: string }[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("type" in value && "data" in value && typeof value.data === "string")
      result.push(value as (typeof result)[number]);
    for (const v of Object.values(value))
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
  }
  visit(message);
  return result;
}
export function fixture(overrides: Partial<Env> = {}) {
  const db = localDatabase(),
    sent: { token: string; messages: Message[] }[] = [],
    pushes: { group: string; messages: Message[]; retryKey: string }[] = [];
  let time = Date.parse("2026-11-01T12:00:00+08:00");
  let current = snapshot();
  let failPush = 0,
    failReply = false,
    remaining = 10000;
  const env: Env = {
    DB: db,
    LINE_CHANNEL_SECRET: "isolated-webhook-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "isolated-no-network",
    ALLOWED_GROUP_IDS: [group, otherGroup].join(","),
    BOT_OWNER_USER_IDS: owner,
    ALLOW_PUBLIC_STATS: "true",
    ENABLE_PUSH: "false",
    USER_COOLDOWN_MS: "0",
    REPLY_LIMIT_PER_MINUTE: "120",
    ...overrides,
  };
  const transport: Transport = {
    async reply(token, messages) {
      if (failReply) throw Error("mock transport failure");
      sent.push({ token, messages });
    },
    async push(group, messages, retryKey) {
      pushes.push({ group, messages, retryKey });
      if (failPush-- > 0) throw Error("mock uncertain network");
    },
    async quota() {
      return { remaining };
    },
    async memberCount() {
      return 15;
    },
    async profile(_g, user) {
      return user === alice
        ? "測試隊員甲"
        : user === bob
          ? "測試隊員乙"
          : "測試隊長";
    },
  };
  const bot = createBot(env, {
    transport,
    snapshot: async () => structuredClone(current),
    now: () => time,
  });
  const call = async (events: Event[], signature?: string, raw?: string) => {
    const body = raw ?? JSON.stringify({ destination: "isolated-bot", events });
    return bot.webhook(
      new Request("https://bot.test/webhook", {
        method: "POST",
        headers: {
          "x-line-signature":
            signature ??
            createHmac("sha256", env.LINE_CHANNEL_SECRET)
              .update(body)
              .digest("base64"),
        },
        body,
      }),
    );
  };
  const event = (user = alice, g = group): Record<string, unknown> => ({
    timestamp: time,
    webhookEventId: randomUUID(),
    deliveryContext: { isRedelivery: false },
    source: { type: "group", groupId: g, userId: user },
    replyToken: randomUUID(),
    mode: "active",
  });
  const text = async (value: string, user = alice, g = group) => {
    time += 2000;
    const e = {
      ...event(user, g),
      type: "message",
      message: { type: "text", id: randomUUID(), text: value },
    } as Event;
    const start = sent.length;
    const r = await call([e]);
    return {
      r,
      event: e,
      message: sent.length > start ? sent.at(-1)!.messages[0] : null,
    };
  };
  const post = async (
    data: string,
    user = alice,
    g = group,
    params?: { datetime: string },
  ) => {
    time += 2000;
    const e = {
      ...event(user, g),
      type: "postback",
      postback: { data, ...(params ? { params } : {}) },
    } as Event;
    const start = sent.length;
    const r = await call([e]);
    return {
      r,
      event: e,
      message: sent.length > start ? sent.at(-1)!.messages[0] : null,
    };
  };
  const bind = async (
    user: string,
    name: string,
    role = "player",
    g = group,
  ) => {
    await db
      .prepare("INSERT INTO bot_members VALUES(?,?,?,?,?,1)")
      .bind(g, user, playerKey(name), name, role)
      .run();
  };
  const addMatch = async (g = group): Promise<Match> => {
    const m: Match = {
      id: randomUUID(),
      group_id: g,
      starts: time + 2 * 86400000,
      meet: time + 2 * 86400000 - 1800000,
      deadline: time + 86400000,
      location: "隔離測試球場",
      opponent: "隔離對手",
      note: "隔離測試",
      created_by: owner,
      reminders: 0,
    };
    await db
      .prepare("INSERT INTO bot_matches VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(
        m.id,
        g,
        m.starts,
        m.meet,
        m.deadline,
        m.location,
        m.opponent,
        m.note,
        owner,
        0,
      )
      .run();
    return m;
  };
  return {
    db,
    env,
    bot,
    sent,
    pushes,
    transport,
    call,
    event,
    text,
    post,
    bind,
    addMatch,
    players: () => engine(current).players(),
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    setSnapshot: (s: Snapshot) => {
      current = s;
    },
    setQuota: (n: number) => {
      remaining = n;
    },
    failPush: (n: number) => {
      failPush = n;
    },
    failReply: () => {
      failReply = true;
    },
    close: () => db.close(),
  };
}
