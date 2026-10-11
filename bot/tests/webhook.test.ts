import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  fixture,
  group,
  alice,
  bob,
  owner,
  otherGroup,
  actions,
} from "./helpers";
import { data } from "../src/flex";
test("raw signature, tampering, malformed JSON, empty verification event and group allowlist", async () => {
  const f = fixture();
  try {
    assert.equal((await f.call([])).status, 200);
    assert.equal((await f.call([], "bad")).status, 401);
    const raw = '{"events":[]}',
      sig = createHmac("sha256", f.env.LINE_CHANNEL_SECRET)
        .update(raw)
        .digest("base64");
    assert.equal((await f.call([], sig, raw + " ")).status, 401);
    assert.equal((await f.call([], undefined, "{")).status, 400);
    const r = await f.text("選單");
    assert.equal(r.r.status, 200);
    assert.equal(r.message?.type, "flex");
    const id = "C" + "9".repeat(32);
    await f.text("選單", alice, id);
    assert.equal(f.sent.length, 1);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_discovery")
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
    const e = {
      ...f.event(),
      source: { type: "user", userId: alice },
      type: "message",
      message: { type: "text", id: "t", text: "選單" },
    };
    await f.call([e as never]);
    assert.equal(f.sent.length, 1);
  } finally {
    f.close();
  }
});
test("redelivery deduplication, missing user ID, ordinary group chat and ambiguous reply do not resend", async () => {
  const f = fixture();
  try {
    const r = await f.text("選單");
    await f.call([r.event]);
    assert.equal(f.sent.length, 1);
    await f.text("大家今天吃什麼");
    assert.equal(f.sent.length, 1);
    const e = {
      ...f.event(),
      source: { type: "group", groupId: group },
      type: "postback",
      postback: { data: data("menu") },
    };
    await f.call([e as never]);
    assert.equal(f.sent.length, 1);
    f.failReply();
    const fail = await f.post(data("menu"));
    await f.call([fail.event]);
    assert.equal(f.sent.length, 1);
    const row = await f.db
      .prepare("SELECT status FROM bot_events WHERE id=?")
      .bind(fail.event.webhookEventId)
      .first<{ status: string }>();
    assert.equal(row?.status, "send_unknown");
  } finally {
    f.close();
  }
});
test("actor and group throttles stop flood without generating more error replies", async () => {
  const f = fixture({ USER_COOLDOWN_MS: "10000", REPLY_LIMIT_PER_MINUTE: "3" });
  try {
    await f.text("選單");
    await f.text("選單");
    await f.text("選單", bob);
    await f.text("選單", owner);
    assert.equal(f.sent.length, 2);
    assert.equal(
      (await f.db
        .prepare(
          "SELECT count(*) AS n FROM bot_events WHERE status='rate-limited'",
        )
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
  } finally {
    f.close();
  }
});
test("unauthorized admin operations, privacy switch, cross-group match and binding consent are enforced", async () => {
  const f = fixture();
  try {
    const m = await f.addMatch(otherGroup);
    const denied = await f.post(data("match", { id: m.id }));
    assert.match(JSON.stringify(denied.message), /這個群組/);
    const admin = await f.post(data("create"));
    assert.match(JSON.stringify(admin.message), /管理員/);
    f.env.ALLOW_PUBLIC_STATS = "false";
    const stats = await f.post(data("pick", { kind: "stats" }));
    assert.match(JSON.stringify(stats.message), /未授權/);
    const bind = await f.post(data("pick", { kind: "bind" }));
    const selected = await f.post(actions(bind.message!)[0].data);
    assert.match(JSON.stringify(selected.message), /同意/);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_binding_requests")
        .bind()
        .first<{ n: number }>())!.n,
      0,
    );
  } finally {
    f.close();
  }
});
