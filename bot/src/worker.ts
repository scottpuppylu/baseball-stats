import { createBot } from "./app";
import { source } from "./source";
import { officialTransport } from "./line";
import type { Env } from "./types";
const sources = new Map<string, ReturnType<typeof source>>();
function application(env: Env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw Error("LINE not configured");
  const base =
    env.DATA_BASE_URL ||
    "https://raw.githubusercontent.com/scottpuppylu/baseball-stats/data/data";
  if (!sources.has(base)) sources.set(base, source(base));
  return createBot(env, {
    snapshot: sources.get(base)!,
    transport: officialTransport(env.LINE_CHANNEL_ACCESS_TOKEN),
  });
}
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/health")
      return new Response(
        JSON.stringify({
          ok: true,
          service: "tk-aero-line-group-bot",
          configured: Boolean(
            env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN,
          ),
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    if (path !== "/webhook") return new Response("Not found", { status: 404 });
    try {
      return await application(env).webhook(request);
    } catch {
      return new Response("Not configured", { status: 503 });
    }
  },
  async scheduled(
    _event: unknown,
    env: Env,
    context: { waitUntil(p: Promise<unknown>): void },
  ) {
    if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
    context.waitUntil(application(env).scheduled());
  },
};
