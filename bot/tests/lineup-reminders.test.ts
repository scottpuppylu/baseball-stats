import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, actions, alice, owner, group, snapshot } from "./helpers";
import { data } from "../src/flex";
import { engine, playerKey } from "../src/source";
import type { Lineup } from "../src/types";
test("exact original 10/11 hitter model, attendance filtering, coach confirmation and stale attendance protection", async () => {
  const f = fixture();
  try {
    const m = await f.addMatch(),
      players = f.players();
    for (let i = 0; i < 12; i++) {
      const u = i === 0 ? alice : "U" + String(i).padStart(32, "0");
      await f.bind(u, players[i].name, i === 0 ? "coach" : "player");
      await f.db
        .prepare("INSERT INTO bot_attendance VALUES(?,?,?,?,?,1)")
        .bind(m.id, u, "yes", f.now(), "seed-" + i)
        .run();
    }
    for (const size of [10, 11]) {
      const response = await f.post(data("lineup", { id: m.id, size }), alice);
      assert.match(JSON.stringify(response.message), /90 分鐘/);
      const confirm = actions(response.message!).find(
        (a) => new URLSearchParams(a.data).get("a") === "confirm-lineup",
      )!;
      const id = new URLSearchParams(confirm.data).get("id")!;
      const candidate = await f.db
        .prepare("SELECT payload FROM bot_lineups WHERE id=?")
        .bind(id)
        .first<{ payload: string }>();
      assert.ok(candidate);
      const result = JSON.parse(candidate.payload) as Lineup;
      const expected = engine(snapshot(), {
        present: players.slice(0, 12).map((p) => p.name),
        size,
      }).recommend();
      assert.deepEqual(
        result.items.map((i) => [i.player.name, i.posInfo.posKey]),
        expected.items.map((i) => [i.player.name, i.posInfo.posKey]),
      );
      assert.equal(result.model.runs, expected.model.runs);
      assert.equal(result.items.length, size);
      assert.ok(result.items.some((i) => i.posInfo.posKey === "P"));
      const approved = await f.post(confirm.data, alice);
      assert.match(JSON.stringify(approved.message), /教練已確認/);
    }
    const response = await f.post(
        data("lineup", { id: m.id, size: 10 }),
        alice,
      ),
      confirm = actions(response.message!).find(
        (a) => new URLSearchParams(a.data).get("a") === "confirm-lineup",
      )!;
    await f.db
      .prepare(
        "UPDATE bot_attendance SET status='no' WHERE match_id=? AND user_id=?",
      )
      .bind(m.id, alice)
      .run();
    const stale = await f.post(confirm.data, owner);
    assert.match(JSON.stringify(stale.message), /已更新/);
  } finally {
    f.close();
  }
});
test("reminders require owner switch, group admin opt-in, official quota and local budget", async () => {
  const f = fixture();
  try {
    const m = await f.addMatch();
    const disabled = await f.post(
      data("reminders", { id: m.id, on: 1 }),
      owner,
    );
    assert.match(JSON.stringify(disabled.message), /尚未啟用/);
    f.env.ENABLE_PUSH = "true";
    const unauthorized = await f.post(
      data("reminders", { id: m.id, on: 1 }),
      alice,
    );
    assert.match(JSON.stringify(unauthorized.message), /管理員/);
    await f.post(data("reminders", { id: m.id, on: 1 }), owner);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_outbox")
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
    assert.equal((await f.bot.scheduled()).sent, 0);
    f.advance(86400000);
    f.setQuota(0);
    assert.equal((await f.bot.scheduled()).sent, 0);
    assert.equal(f.pushes.length, 0);
    assert.equal(
      (await f.db
        .prepare(
          "SELECT count(*) AS n FROM bot_outbox WHERE status='budget-blocked'",
        )
        .bind()
        .first<{ n: number }>())!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("scheduled sends only the same group, retains retry key and never duplicates a completed reminder", async () => {
  const f = fixture({ ENABLE_PUSH: "true" });
  try {
    const m = await f.addMatch();
    await f.post(data("reminders", { id: m.id, on: 1 }), owner);
    f.advance(86400000);
    f.failPush(1);
    assert.equal((await f.bot.scheduled()).sent, 0);
    assert.equal((await f.bot.scheduled()).sent, 1);
    assert.equal(f.pushes.length, 2);
    assert.equal(f.pushes[0].retryKey, f.pushes[1].retryKey);
    assert.equal(f.pushes[1].group, group);
    assert.equal((await f.bot.scheduled()).sent, 0);
    assert.equal(f.pushes.length, 2);
    assert.equal(
      (await f.db
        .prepare("SELECT count FROM bot_limits WHERE key LIKE ?")
        .bind("push-recipient:%")
        .first<{ count: number }>())!.count,
      15,
    );
  } finally {
    f.close();
  }
});
test("zero local budget or disabled owner push prevents sends", async () => {
  const f = fixture({ ENABLE_PUSH: "true", MONTHLY_PUSH_RECIPIENT_LIMIT: "0" });
  try {
    const m = await f.addMatch();
    await f.post(data("reminders", { id: m.id, on: 1 }), owner);
    f.advance(86400000);
    assert.equal((await f.bot.scheduled()).sent, 0);
    assert.equal(f.pushes.length, 0);
    f.env.ENABLE_PUSH = "false";
    assert.equal((await f.bot.scheduled()).skipped, true);
  } finally {
    f.close();
  }
});
test("reminders cannot disclose another group's match, bypass an allowlist or send a disabled match", async()=>{
  const f=fixture({ENABLE_PUSH:"true"});
  try{
    const m=await f.addMatch();await f.post(data("reminders",{id:m.id,on:1}),owner);f.advance(86400000);
    const other='C'+'2'.repeat(32);
    await f.db.prepare('UPDATE bot_outbox SET group_id=?').bind(other).run();
    assert.equal((await f.bot.scheduled()).sent,0);
    await f.db.prepare('UPDATE bot_outbox SET group_id=?').bind(group).run();f.env.ALLOWED_GROUP_IDS=other;
    assert.equal((await f.bot.scheduled()).sent,0);
    f.env.ALLOWED_GROUP_IDS=group;await f.db.prepare('UPDATE bot_matches SET reminders=0').run();
    assert.equal((await f.bot.scheduled()).sent,0);assert.equal(f.pushes.length,0);
  }finally{f.close();}
});
test("admin may re-enable future cancelled reminders without duplicating outbox entries", async () => {
  const f = fixture({ ENABLE_PUSH: "true" });
  try {
    const m = await f.addMatch();
    await f.post(data("reminders", { id: m.id, on: 1 }), owner);
    await f.post(data("reminders", { id: m.id, on: 0 }), owner);
    await f.post(data("reminders", { id: m.id, on: 1 }), owner);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_outbox WHERE status='pending'")
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_outbox")
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
  } finally {
    f.close();
  }
});
