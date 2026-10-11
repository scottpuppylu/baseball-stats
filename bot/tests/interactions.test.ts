import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, actions, alice, bob, owner, group } from "./helpers";
import { data } from "../src/flex";
import type { Flow, Message, Match } from "../src/types";
const action = (message: Message, a: string) =>
  actions(message).find((x) => new URLSearchParams(x.data).get("a") === a)!
    .data;
test("two users compare independently; other users cannot use another actor selection flow", async () => {
  const f = fixture();
  try {
    const a = await f.post(data("pick", { kind: "compare" }), alice),
      b = await f.post(data("pick", { kind: "compare" }), bob);
    const other = await f.post(action(a.message!, "select"), bob);
    assert.match(JSON.stringify(other.message), /其他隊員/);
    const anext = await f.post(action(a.message!, "select"), alice),
      bnext = await f.post(actions(b.message!)[1].data, bob);
    const flows = (
      await f.db
        .prepare("SELECT * FROM bot_flows ORDER BY user_id")
        .bind()
        .all<Flow>()
    ).results;
    assert.equal(flows.length, 2);
    assert.notEqual(
      JSON.parse(flows[0].payload).first,
      JSON.parse(flows[1].payload).first,
    );
    const aresult = await f.post(action(anext.message!, "select"), alice),
      bresult = await f.post(action(bnext.message!, "select"), bob);
    assert.match(JSON.stringify(aresult.message), /核心|K%/);
    assert.match(JSON.stringify(bresult.message), /K%/);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_flows")
        .bind()
        .first<{ n: number }>())!.n,
      0,
    );
    const stale = await f.post(action(anext.message!, "select"), alice);
    assert.match(JSON.stringify(stale.message), /過期/);
  } finally {
    f.close();
  }
});
test("consented binding is pending, only admin approves, duplicates never replace another player", async () => {
  const f = fixture();
  try {
    const pick = await f.post(data("pick", { kind: "bind" }), alice),
      choose = await f.post(action(pick.message!, "select"), alice),
      request = await f.post(action(choose.message!, "bind-request"), alice);
    assert.match(JSON.stringify(request.message), /待隊長確認/);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_members")
        .bind()
        .first<{ n: number }>())!.n,
      0,
    );
    const denied = await f.post(action(request.message!, "approve"), bob);
    assert.match(JSON.stringify(denied.message), /管理員/);
    const approved = await f.post(action(request.message!, "approve"), owner);
    assert.match(JSON.stringify(approved.message), /已確認/);
    assert.equal(
      (await f.db
        .prepare("SELECT role FROM bot_members WHERE user_id=?")
        .bind(alice)
        .first<{ role: string }>())!.role,
      "player",
    );
    const pick2 = await f.post(data("pick", { kind: "bind" }), bob),
      choose2 = await f.post(action(pick2.message!, "select"), bob),
      req2 = await f.post(action(choose2.message!, "bind-request"), bob);
    const dup = await f.post(action(req2.message!, "approve"), owner);
    assert.match(JSON.stringify(dup.message), /已綁定|無法完成/);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_members")
        .bind()
        .first<{ n: number }>())!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("captain creates a match entirely in group with native datepickers and isolated text wizard", async () => {
  const f = fixture();
  try {
    const start = await f.post(data("create"), owner);
    const next = await f.post(action(start.message!, "date"), owner, group, {
      datetime: "2026-12-01T19:00",
    });
    const stolen = await f.post(action(next.message!, "date"), alice, group, {
      datetime: "2026-12-01T18:00",
    });
    assert.match(JSON.stringify(stolen.message), /管理員/);
    const meet = await f.post(action(next.message!, "date"), owner, group, {
      datetime: "2026-12-01T18:30",
    });
    const cutoff = await f.post(action(meet.message!, "date"), owner, group, {
      datetime: "2026-12-01T12:00",
    });
    assert.match(JSON.stringify(cutoff.message), /地點/);
    const chat = await f.text("其他隊員隨意聊天", alice);
    assert.equal(chat.message, null);
    await f.text("隔離球場", owner);
    await f.text("隔離對手", owner);
    const confirm = await f.text("穿深色球衣", owner);
    assert.match(JSON.stringify(confirm.message), /確認建立/);
    const created = await f.post(
      action(confirm.message!, "create-confirm"),
      owner,
    );
    assert.match(JSON.stringify(created.message), /出席/);
    const rows = (
      await f.db.prepare("SELECT * FROM bot_matches").bind().all<Match>()
    ).results;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].location, "隔離球場");
    assert.equal(
      new Date(rows[0].starts).toISOString(),
      "2026-12-01T11:00:00.000Z",
    );
    await f.post(action(confirm.message!, "create-confirm"), owner);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_matches")
        .bind()
        .first<{ n: number }>())!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("persistent independent attendance, repeated events and out-of-order updates cannot double count or overwrite newer status", async () => {
  const f = fixture();
  try {
    const players = f.players();
    await f.bind(alice, players[0].name);
    await f.bind(bob, players[1].name);
    const m = await f.addMatch();
    const [a, b] = await Promise.all([
      f.post(data("attend", { id: m.id, status: "yes" }), alice),
      f.post(data("attend", { id: m.id, status: "maybe" }), bob),
    ]);
    assert.equal(a.r.status, 200);
    assert.equal(b.r.status, 200);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) AS n FROM bot_attendance")
        .bind()
        .first<{ n: number }>())!.n,
      2,
    );
    const newer = await f.post(
      data("attend", { id: m.id, status: "no" }),
      alice,
    );
    await f.call([a.event]);
    assert.equal(
      (await f.db
        .prepare("SELECT status FROM bot_attendance WHERE user_id=?")
        .bind(alice)
        .first<{ status: string }>())!.status,
      "no",
    );
    const old = { ...a.event, webhookEventId: "late-unique-event" };
    await f.call([old]);
    assert.equal(
      (await f.db
        .prepare("SELECT status,version FROM bot_attendance WHERE user_id=?")
        .bind(alice)
        .first<{ status: string; version: number }>())!.version,
      2,
    );
    assert.match(JSON.stringify(f.sent.at(-1)?.messages), /較新的/);
    const roster = await f.post(data("match", { id: m.id }), bob);
    assert.match(JSON.stringify(roster.message), /未回覆 0/);
    assert.match(JSON.stringify(roster.message), /請假/);
    f.advance(86400000 + 60000);
    const closed = await f.post(
      data("attend", { id: m.id, status: "yes" }),
      bob,
    );
    assert.match(JSON.stringify(closed.message), /截止/);
    assert.equal(
      (await f.db
        .prepare("SELECT status FROM bot_attendance WHERE user_id=?")
        .bind(bob)
        .first<{ status: string }>())!.status,
      "maybe",
    );
  } finally {
    f.close();
  }
});
test("LINE member leave deactivates binding and future attendance without enumerating all members", async () => {
  const f = fixture();
  try {
    await f.bind(alice, f.players()[0].name);
    const m = await f.addMatch();
    await f.post(data("attend", { id: m.id, status: "yes" }), alice);
    const e = {
      ...f.event(owner),
      type: "memberLeft",
      left: { members: [{ type: "user", userId: alice }] },
    };
    await f.call([e as never]);
    assert.equal(
      (await f.db
        .prepare("SELECT active FROM bot_members")
        .bind()
        .first<{ active: number }>())!.active,
      0,
    );
    const failed = await f.post(
      data("attend", { id: m.id, status: "no" }),
      alice,
    );
    assert.match(JSON.stringify(failed.message), /身分綁定/);
  } finally {
    f.close();
  }
});
test("statistics cards, full ranking pagination, auto minimum PA, comparison samples and postgame are operable", async () => {
  const f = fixture();
  try {
    const pick = await f.post(data("pick", { kind: "stats" })),
      stats = await f.post(action(pick.message!, "select"));
    assert.match(JSON.stringify(stats.message), /PA|wRC\+/);
    assert.match(JSON.stringify(stats.message), /最近五場|生涯/);
    const rank = await f.post(
      data("rank", { metric: "ops", min: "auto", page: 0 }),
    );
    const minimum = (await import("../src/source"))
      .engine((await import("./helpers")).snapshot())
      .minimumPa();
    assert.match(
      JSON.stringify(rank.message),
      new RegExp(`最低 PA：${minimum}`),
    );
    const full = await f.post(
      data("rank", { metric: "h", min: "auto", page: 0 }),
    );
    assert.match(JSON.stringify(full.message), /最低 PA：0/);
    assert.ok(
      actions(full.message!).some(
        (a) => new URLSearchParams(a.data).get("page") === "1",
      ),
    );
    const second = await f.post(
      actions(full.message!).find((a) => a.label === "下一頁")!.data,
    );
    assert.match(JSON.stringify(second.message), /11\./);
    const reports = await f.post(data("reports", { page: 0 })),
      report = await f.post(action(reports.message!, "report"));
    assert.match(JSON.stringify(report.message), /MVP|亮點/);
    assert.match(JSON.stringify(report.message), /生涯紀錄更新/);
  } finally {
    f.close();
  }
});
