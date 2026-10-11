// TEST ENTRY ONLY. Loopback Wrangler smoke harness, not the production Worker.
import { createBot } from "../src/app";
import productionWorker from "../src/worker";
import { digest } from "../src/source";
import type { Env, Message, Snapshot } from "../src/types";
import logs from "../../tests/fixtures/data/logs.json";
import games from "../../tests/fixtures/data/games.json";
import defense from "../../tests/fixtures/data/defense.json";
import avatars from "../../tests/fixtures/data/avatars.json";
const group = "C" + "1".repeat(32),
  alice = "U" + "b".repeat(32),
  bob = "U" + "c".repeat(32);
const payload = { logs, games, defense, avatars, guests: [] };
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if(url.pathname.startsWith('/production/')){
      url.pathname=url.pathname.slice('/production'.length);
      return productionWorker.fetch(new Request(url,request),env);
    }
    if (url.pathname === "/health")
      return Response.json({ mode: "isolated-worker-test" });
    if (url.pathname === "/seed") {
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO bot_members VALUES(?,?,?,?,?,1)",
        ).bind(group, alice, "test-a", "盧宣嘉", "player"),
        env.DB.prepare(
          "INSERT OR IGNORE INTO bot_members VALUES(?,?,?,?,?,1)",
        ).bind(group, bob, "test-b", "簡承均", "player"),
        env.DB.prepare(
          "INSERT OR IGNORE INTO bot_matches VALUES(?,?,?,?,?,?,?,?,?,0)",
        ).bind(
          "smoke-match",
          group,
          now + 172800000,
          now + 172000000,
          now + 86400000,
          "隔離球場",
          "隔離對手",
          "測試",
          alice,
        ),
      ]);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/state")
      return Response.json(
        (
          await env.DB.prepare(
            "SELECT user_id,status,version FROM bot_attendance ORDER BY user_id",
          ).all()
        ).results,
      );
    const sent: Message[] = [];
    const bot = createBot(env, {
      snapshot: async () =>
        ({
          ...payload,
          digest: digest(payload),
          fetchedAt: Date.now(),
          source: "isolated-worker-fixtures",
        }) as unknown as Snapshot,
      transport: {
        async reply(_t, m) {
          sent.push(...m);
        },
        async push() {
          throw Error("test-only push disabled");
        },
        async quota() {
          return { remaining: 0 };
        },
        async memberCount() {
          return 2;
        },
        async profile() {
          return null;
        },
      },
    });
    const response = await bot.webhook(request);
    return Response.json(
      { status: response.status, messages: sent },
      { status: response.status },
    );
  },
};
