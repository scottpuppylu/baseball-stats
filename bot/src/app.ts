import { validateSignature } from "@line/bot-sdk";
import type {
  Env,
  Dependencies,
  Context,
  Event,
  Member,
  Message,
  Match,
} from "./types";
import { Controller } from "./controller";
import { card, failure, postback } from "./flex";
export const list = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const limit = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(max, n) : fallback;
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function createBot(env: Env, deps: Dependencies) {
  const controller = new Controller(env, deps),
    store = controller.store;
  const now = () => deps.now?.() ?? Date.now();
  async function send(c: Context, message: Message) {
    try {
      await deps.transport.reply(c.replyToken, [message]);
      await store.run(
        "UPDATE bot_events SET status='done' WHERE id=?",
        c.eventId,
      );
    } catch {
      await store.run(
        "UPDATE bot_events SET status='send_unknown' WHERE id=?",
        c.eventId,
      );
      await controller.audit(c, "reply-send-unknown", c.eventId);
    }
  }
  async function budget(c: Context) {
    const maximum = limit(env.REPLY_LIMIT_PER_MINUTE, 12, 120);
    const group = await store.run(
      "INSERT INTO bot_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<?",
      `reply:${c.group}:${Math.floor(c.now / 60000)}`,
      c.now,
      maximum,
    );
    if (maximum === 0 || !group.meta.changes) return false;
    const cooldown = limit(env.USER_COOLDOWN_MS, 1500, 60000);
    const actor = await store.run(
      "INSERT INTO bot_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at WHERE bot_limits.at<=?",
      `user:${c.group}:${c.user}`,
      c.now,
      c.now - cooldown,
    );
    return actor.meta.changes > 0;
  }
  async function process(event: Event) {
    if (!("source" in event) || !event.source || event.source.type !== "group")
      return;
    const group = event.source.groupId;
    if (!group) return;
    await store.run(
      "INSERT OR IGNORE INTO bot_discovery VALUES(?,?)",
      group,
      now(),
    );
    if (!list(env.ALLOWED_GROUP_IDS).includes(group)) return;
    const id = event.webhookEventId;
    if (!id || typeof id !== "string" || id.length > 128) return;
    if (!(await store.claimEvent(id, group, now()))) return;
    if (event.type === "leave") {
      await store.run(
        "UPDATE bot_members SET active=0 WHERE group_id=?",
        group,
      );
      await store.run(
        "UPDATE bot_outbox SET status='cancelled' WHERE group_id=? AND status IN ('pending','retry')",
        group,
      );
      await store.run("UPDATE bot_events SET status='done' WHERE id=?", id);
      return;
    }
    if (event.type === "memberLeft") {
      for (const member of event.left.members) {
        if (member.type === "user") {
          await store.run(
            "UPDATE bot_members SET active=0 WHERE group_id=? AND user_id=?",
            group,
            member.userId,
          );
          await store.run(
            "DELETE FROM bot_flows WHERE group_id=? AND user_id=?",
            group,
            member.userId,
          );
        }
      }
      await store.run("UPDATE bot_events SET status='done' WHERE id=?", id);
      return;
    }
    if (event.type !== "message" && event.type !== "postback") {
      await store.run("UPDATE bot_events SET status='ignored' WHERE id=?", id);
      return;
    }
    const user = event.source.userId,
      replyToken = event.replyToken;
    if (!user || !replyToken) {
      await store.run(
        "UPDATE bot_events SET status='missing-identity' WHERE id=?",
        id,
      );
      return;
    }
    if (
      typeof event.timestamp !== "number" ||
      event.timestamp < now() - 86400000 ||
      event.timestamp > now() + 300000
    ) {
      await store.run("UPDATE bot_events SET status='stale' WHERE id=?", id);
      return;
    }
    const member = await store.one<Member>(
      "SELECT * FROM bot_members WHERE group_id=? AND user_id=? AND active=1",
      group,
      user,
    );
    const c: Context = {
      group,
      user,
      eventId: id,
      replyToken,
      timestamp: event.timestamp,
      role: list(env.BOT_OWNER_USER_IDS).includes(user)
        ? "admin"
        : member?.role || "guest",
      member,
      now: now(),
    };
    const text =
      event.type === "message" && event.message.type === "text"
        ? event.message.text.trim()
        : null;
    let params: URLSearchParams | undefined;
    if (event.type === "postback") {
      if (event.postback.data.length > 300) {
        await store.run(
          "UPDATE bot_events SET status='invalid' WHERE id=?",
          id,
        );
        return;
      }
      params = new URLSearchParams(event.postback.data);
    } else if (text && ["選單", "球隊選單", "menu"].includes(text))
      params = new URLSearchParams("a=menu");
    else if (text === "取消") {
      await store.run(
        "DELETE FROM bot_flows WHERE group_id=? AND user_id=?",
        group,
        user,
      );
      params = new URLSearchParams("a=menu");
    } else if (
      !text ||
      !(await store.one(
        "SELECT id FROM bot_flows WHERE group_id=? AND user_id=? AND kind=? AND expires>?",
        group,
        user,
        "create",
        c.now,
      ))
    ) {
      await store.run("UPDATE bot_events SET status='ignored' WHERE id=?", id);
      return;
    }
    if (!(await budget(c))) {
      await store.run(
        "UPDATE bot_events SET status='rate-limited' WHERE id=?",
        id,
      );
      return;
    }
    let message: Message | null;
    try {
      message = params
        ? await controller.dispatch(
            c,
            params,
            event.type === "postback"
              ? event.postback.params?.datetime
              : undefined,
          )
        : await controller.wizardText(c, text!);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      message = failure(
        /(?:SQL|constraint|database|UNIQUE|FOREIGN KEY|syntax error)/i.test(
          detail,
        )
          ? "操作無法完成，請更新選單或由隊長確認。"
          : detail || "操作失敗，請稍後重試。",
      );
      await controller.audit(
        c,
        "operation-failed",
        params?.get("a") || "wizard",
      );
    }
    if (message) await send(c, message);
    else
      await store.run("UPDATE bot_events SET status='ignored' WHERE id=?", id);
  }
  async function webhook(request: Request) {
    if (request.method !== "POST") return response({ error: "method" }, 405);
    if (!env.LINE_CHANNEL_SECRET)
      return response({ error: "not configured" }, 503);
    if (Number(request.headers.get("Content-Length")) > 1_000_000)
      return response({ error: "too large" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1_000_000)
      return response({ error: "too large" }, 413);
    const signature = request.headers.get("x-line-signature") || "";
    if (
      !signature ||
      !validateSignature(raw, env.LINE_CHANNEL_SECRET, signature)
    )
      return response({ error: "signature" }, 401);
    let body: { events?: Event[] };
    try {
      body = JSON.parse(raw);
    } catch {
      return response({ error: "json" }, 400);
    }
    if (!Array.isArray(body.events) || body.events.length > 100)
      return response({ error: "events" }, 400);
    try {
      for (const event of body.events) await process(event);
    } catch {
      return response({ error: "processing" }, 500);
    }
    return response({ ok: true });
  }
  async function scheduled() {
    if (env.ENABLE_PUSH !== "true" || env.ALLOW_PUBLIC_STATS !== "true")
      return { sent: 0, skipped: true };
    const time = now();
    let sent = 0;
    const rows = await store.all<{
      id: string;
      match_id: string;
      group_id: string;
      due: number;
      retry_key: string;
      attempts: number;
      reserved: number;
      claimed_at: number | null;
    }>(
      "SELECT * FROM bot_outbox WHERE status IN ('pending','retry') AND due<=? AND due>? AND attempts<3 ORDER BY due LIMIT 10",
      time,
      time - 3600000,
    );
    for (const row of rows) {
      if (!list(env.ALLOWED_GROUP_IDS).includes(row.group_id)) continue;
      const match = await store.one<Match>(
        "SELECT * FROM bot_matches WHERE id=? AND group_id=? AND reminders=1 AND starts>?",
        row.match_id,
        row.group_id,
        time,
      );
      if (!match) continue;
      const claim = await store.run(
        "UPDATE bot_outbox SET status='sending',attempts=attempts+1,claimed_at=? WHERE id=? AND status IN ('pending','retry')",
        time,
        row.id,
      );
      if (!claim.meta.changes) continue;
      try {
        if (!row.reserved) {
          const [quota, count] = await Promise.all([
            deps.transport.quota(),
            deps.transport.memberCount(row.group_id),
          ]);
          if (!Number.isInteger(count) || count < 1 || quota.remaining < count)
            throw Error("quota");
          const month = new Date(time).toISOString().slice(0, 7),
            day = new Date(time).toISOString().slice(0, 10);
          const caps = [
            {
              key: `push-recipient:${month}`,
              amount: count,
              max: limit(env.MONTHLY_PUSH_RECIPIENT_LIMIT, 200, 1000000),
            },
            {
              key: `push-operation:${day}`,
              amount: 1,
              max: limit(env.PUSH_LIMIT_PER_DAY, 5, 100),
            },
          ];
          for (const cap of caps) {
            if (cap.amount > cap.max) throw Error("budget");
            const r = await store.run(
              "INSERT INTO bot_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count WHERE count+excluded.count<=?",
              cap.key,
              cap.amount,
              time,
              cap.max,
            );
            if (!r.meta.changes) throw Error("budget");
          }
          await store.run(
            "UPDATE bot_outbox SET reserved=? WHERE id=?",
            count,
            row.id,
          );
        }
        const c: Context = {
          group: row.group_id,
          user: "scheduler",
          eventId: "reminder-" + row.id,
          timestamp: time,
          replyToken: "",
          role: "admin",
          member: null,
          now: time,
        };
        const message = await controller.matchMessage(c, match);
        await deps.transport.push(row.group_id, [message], row.retry_key);
        await store.run(
          "UPDATE bot_outbox SET status='sent' WHERE id=?",
          row.id,
        );
        await controller.audit(c, "push-reminder", row.id);
        sent++;
      } catch (error) {
        const blocked =
          error instanceof Error && ["quota", "budget"].includes(error.message);
        await store.run(
          "UPDATE bot_outbox SET status=? WHERE id=?",
          blocked ? "budget-blocked" : "retry",
          row.id,
        );
      }
    }
    // Never replay ambiguous replies; reminder retry keys remain stable across network failures.
    await store.run(
      "UPDATE bot_outbox SET status='retry' WHERE status='sending' AND claimed_at<? AND attempts<3",
      time - 60000,
    );
    await store.run("DELETE FROM bot_flows WHERE expires<?", time);
    await store.run("DELETE FROM bot_events WHERE at<?", time - 30 * 86400000);
    await store.run("DELETE FROM bot_limits WHERE at<?", time - 35 * 86400000);
    return { sent, skipped: false };
  }
  return { webhook, scheduled, controller };
}
