// Loopback-only executable sandbox. Never loads LINE credentials or contacts LINE/GitHub.
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createBot } from "../src/app";
import { localDatabase } from "../src/local-db";
import { digest } from "../src/source";
import type { Env, Snapshot, Message, Event } from "../src/types";
mkdirSync(".local/line-mock/messages", { recursive: true });
const group = "C" + "1".repeat(32),
  user = "U" + "a".repeat(32),
  secret = "local-isolated-secret";
const read = (n: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../tests/fixtures/data/${n}.json`, import.meta.url),
      "utf8",
    ),
  );
const data = {
  logs: read("logs"),
  games: read("games"),
  defense: read("defense"),
  avatars: read("avatars"),
  guests: [],
};
const snapshot: Snapshot = {
  ...data,
  digest: digest(data),
  fetchedAt: Date.now(),
  source: "ISOLATED FIXTURES — not formal data",
};
const db = localDatabase(".local/line-mock/state.sqlite");
const env: Env = {
  DB: db,
  LINE_CHANNEL_SECRET: secret,
  LINE_CHANNEL_ACCESS_TOKEN: "mock-no-network",
  ALLOWED_GROUP_IDS: group,
  BOT_OWNER_USER_IDS: user,
  ALLOW_PUBLIC_STATS: "true",
  ENABLE_PUSH: "false",
  USER_COOLDOWN_MS: "0",
  REPLY_LIMIT_PER_MINUTE: "120",
};
const messages: Message[] = [];
const bot = createBot(env, {
  snapshot: async () => snapshot,
  transport: {
    async reply(_token, batch) {
      messages.push(...batch);
      for (const m of batch)
        writeFileSync(
          `.local/line-mock/messages/${Date.now()}-${randomUUID()}.json`,
          JSON.stringify(m, null, 2),
        );
    },
    async push() {
      throw Error("Mock push is disabled");
    },
    async quota() {
      return { remaining: 0 };
    },
    async memberCount() {
      return 1;
    },
    async profile() {
      return "隔離測試隊長";
    },
  },
});
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ mode: "mock", productionNetwork: false, group, user }),
      );
      return;
    }
    if (req.method !== "POST" || req.url !== "/mock/event") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64000) {
        res.writeHead(413).end();
        return;
      }
    }
    const input = JSON.parse(raw),
      actor = typeof input.user === "string" ? input.user : user;
    const event = {
      type: input.data ? "postback" : "message",
      timestamp: Date.now(),
      webhookEventId: randomUUID(),
      replyToken: randomUUID(),
      mode: "active",
      deliveryContext: { isRedelivery: false },
      source: { type: "group", groupId: group, userId: actor },
      ...(input.data
        ? {
            postback: {
              data: input.data,
              ...(input.datetime
                ? { params: { datetime: input.datetime } }
                : {}),
            },
          }
        : {
            message: {
              type: "text",
              id: randomUUID(),
              text: input.text || "選單",
            },
          }),
    } as Event;
    const body = JSON.stringify({ events: [event] }),
      start = messages.length;
    const response = await bot.webhook(
      new Request("https://mock.test/webhook", {
        method: "POST",
        body,
        headers: {
          "x-line-signature": createHmac("sha256", secret)
            .update(body)
            .digest("base64"),
        },
      }),
    );
    res.setHeader("Content-Type", "application/json");
    res
      .writeHead(response.status)
      .end(JSON.stringify({ mode: "mock", messages: messages.slice(start) }));
  } catch {
    res.writeHead(400).end("Invalid sandbox request");
  }
});
server.listen(Number(process.env.LINE_MOCK_PORT || 8788), "127.0.0.1", () =>
  console.log(
    '隔離 LINE 模擬器 http://127.0.0.1:8788 — POST /mock/event {"text":"選單"}; 按鈕用 {"data":"原 postback data"}。狀態保存於 .local/line-mock；不連線正式 LINE。',
  ),
);
process.on("SIGINT", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
