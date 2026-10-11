import type {
  Context,
  Env,
  Dependencies,
  Flow,
  Match,
  Member,
  Attendance,
  Message,
  Player,
  Snapshot,
  Lineup,
} from "./types";
import { Store } from "./store";
import { engine, playerKey, digest } from "./source";
import * as F from "./flex";

export class Controller {
  readonly store: Store;
  constructor(
    readonly env: Env,
    readonly deps: Dependencies,
  ) {
    this.store = new Store(env.DB);
  }
  admin(c: Context) {
    if (c.role !== "admin") throw Error("只有隊長／管理員可以執行這個操作。");
  }
  coach(c: Context) {
    if (!["coach", "admin"].includes(c.role))
      throw Error("需要教練或管理員權限。");
  }
  member(c: Context) {
    if (!c.member?.active)
      throw Error("請先在選單申請身分綁定，經隊長確認後才能報名。");
  }
  statsAllowed() {
    if (this.env.ALLOW_PUBLIC_STATS !== "true")
      throw Error("尚未授權在此群組公開球員數據，請隊長先設定資料分享授權。");
  }
  async snapshot() {
    return this.deps.snapshot();
  }
  async getFlow(c: Context, id: string, v: string) {
    const f = await this.store.one<Flow>(
      "SELECT * FROM bot_flows WHERE id=? AND group_id=? AND user_id=? AND expires>?",
      id,
      c.group,
      c.user,
      c.now,
    );
    if (!f) throw Error("這張選擇卡屬於其他隊員或已過期，請重新輸入「選單」。");
    if (f.version !== Number(v))
      throw Error("這張卡已被使用或更新，請重新選擇。");
    return f;
  }
  async match(c: Context, id: string) {
    const m = await this.store.one<Match>(
      "SELECT * FROM bot_matches WHERE id=? AND group_id=?",
      id,
      c.group,
    );
    if (!m) throw Error("找不到這個群組的比賽。");
    return m;
  }
  async members(c: Context) {
    return this.store.all<Member>(
      "SELECT * FROM bot_members WHERE group_id=? AND active=1 ORDER BY name",
      c.group,
    );
  }
  async roster(c: Context, m: Match) {
    const members = await this.members(c),
      rows = await this.store.all<Attendance>(
        "SELECT * FROM bot_attendance WHERE match_id=?",
        m.id,
      );
    const names: Record<string, string[]> = {
      yes: [],
      maybe: [],
      no: [],
      pending: [],
    };
    for (const p of members)
      names[
        rows.find((a) => a.user_id === p.user_id)?.status || "pending"
      ].push(p.name);
    return {
      members,
      rows,
      names,
      counts: {
        yes: names.yes.length,
        maybe: names.maybe.length,
        no: names.no.length,
        pending: names.pending.length,
      },
    };
  }
  async matchMessage(c: Context, m: Match) {
    const r = await this.roster(c, m);
    return F.matchCard(m, r.counts, r.names, c.now >= m.deadline);
  }
  async audit(c: Context, action: string, target: string) {
    return this.store.audit(c.group, c.user, c.eventId, action, target, c.now);
  }
  async choose(c: Context, kind: string) {
    if (!["stats", "compare", "bind"].includes(kind))
      throw Error("未知的球員選擇功能。");
    if (kind !== "bind") this.statsAllowed();
    const s = await this.snapshot(),
      e = engine(s);
    const flow = await this.store.flow(
      c.group,
      c.user,
      kind,
      "first",
      {},
      c.now,
    );
    return F.playerPicker(
      e.players(),
      e.jersey,
      s.avatars,
      flow.id,
      flow.version,
      0,
      kind,
    );
  }
  async selected(c: Context, p: URLSearchParams) {
    const flow = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
    if (!["stats", "compare", "bind"].includes(flow.kind))
      throw Error("不適用這張選擇卡。");
    if (flow.kind !== "bind") this.statsAllowed();
    const s = await this.snapshot(),
      e = engine(s),
      player = e.players().find((x) => playerKey(x.name) === p.get("p"));
    if (!player) throw Error("球員已異動，請重新選擇。");
    if (flow.kind === "stats") {
      await this.store.run(
        "DELETE FROM bot_flows WHERE id=? AND version=?",
        flow.id,
        flow.version,
      );
      return F.playerCard(
        player,
        e.jersey(player.name),
        e.recent(player.name),
        e.career(player.name),
        s.avatars[player.name],
      );
    }
    if (flow.kind === "compare") {
      if (flow.step === "first") {
        const next = await this.store.updateFlow(flow, "second", {
          first: playerKey(player.name),
        });
        return F.playerPicker(
          e.players().filter((x) => x.name !== player.name),
          e.jersey,
          s.avatars,
          next.id,
          next.version,
          0,
          "compare",
        );
      }
      const first = e
        .players()
        .find((x) => playerKey(x.name) === JSON.parse(flow.payload).first);
      if (!first || first.name === player.name)
        throw Error("請選擇兩位不同球員。");
      await this.store.run(
        "DELETE FROM bot_flows WHERE id=? AND version=?",
        flow.id,
        flow.version,
      );
      return F.comparison(first, player);
    }
    const next = await this.store.updateFlow(flow, "consent", {
      name: player.name,
      key: playerKey(player.name),
    });
    return F.card(
      "確認身分綁定",
      [
        `你選擇：${player.name}`,
        "同意將此姓名、報名狀態顯示在這個群組。隊長會核對身分，申請不會自動取得管理權限。",
      ],
      [
        F.postback("同意並申請", "bind-request", {
          flow: next.id,
          v: next.version,
        }),
        F.postback("取消", "menu"),
      ],
    );
  }
  async bindRequest(c: Context, p: URLSearchParams) {
    const flow = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
    if (flow.kind !== "bind" || flow.step !== "consent")
      throw Error("請先確認身分綁定與分享同意。");
    if (c.member?.active) throw Error("你已綁定球員；變更需由擁有者受控處理。");
    const payload = JSON.parse(flow.payload) as { name: string; key: string };
    const existing = await this.store.one<{ id: string }>(
      "SELECT id FROM bot_binding_requests WHERE group_id=? AND user_id=? AND status=?",
      c.group,
      c.user,
      "pending",
    );
    if (existing) throw Error("已有待審核申請，請隊長在「隊長管理」確認。");
    const id = crypto.randomUUID(),
      display =
        (await this.deps.transport.profile(c.group, c.user)) ||
        "提出申請的隊員";
    await this.store.db.batch([
      this.store.statement(
        "INSERT INTO bot_binding_requests VALUES(?,?,?,?,?,?,?,?)",
        id,
        c.group,
        c.user,
        payload.key,
        payload.name,
        display,
        "pending",
        c.now,
      ),
      this.store.statement(
        "DELETE FROM bot_flows WHERE id=? AND version=?",
        flow.id,
        flow.version,
      ),
    ]);
    await this.audit(c, "request-binding", id);
    return F.card(
      "身分綁定待隊長確認",
      [
        `${display} 申請綁定 ${payload.name}`,
        `申請編號 ${id.slice(0, 8)}`,
        "請隊長確認本人後核准；LINE User ID 不會顯示到群組。",
      ],
      [
        F.postback("隊長核准", "approve", { id, role: "player" }),
        F.postback("隊長拒絕", "reject", { id }),
      ],
    );
  }
  async approve(c: Context, p: URLSearchParams, reject = false) {
    this.admin(c);
    const r = await this.store.one<{
      id: string;
      user_id: string;
      name: string;
      player_key: string;
      status: string;
    }>(
      "SELECT * FROM bot_binding_requests WHERE id=? AND group_id=?",
      p.get("id"),
      c.group,
    );
    if (!r || r.status !== "pending") throw Error("申請已處理或不存在。");
    if (reject) {
      await this.store.run(
        "UPDATE bot_binding_requests SET status='rejected' WHERE id=? AND status='pending'",
        r.id,
      );
      await this.audit(c, "reject-binding", r.id);
      return F.card("已拒絕身分申請", [r.name]);
    }
    const role = p.get("role") === "coach" ? "coach" : "player";
    try {
      const results = await this.store.db.batch([
        this.store.statement(
          "INSERT INTO bot_members(group_id,user_id,player_key,name,role,active) SELECT group_id,user_id,player_key,name,?,1 FROM bot_binding_requests WHERE id=? AND status='pending'",
          role,
          r.id,
        ),
        this.store.statement(
          "UPDATE bot_binding_requests SET status='approved' WHERE id=? AND status='pending'",
          r.id,
        ),
      ]);
      if (!results[0].meta.changes) throw Error("申請已更新");
    } catch {
      throw Error("此 LINE 帳號或球員已綁定，請隊長核對；沒有覆蓋原身分。");
    }
    await this.audit(c, "approve-binding", r.id);
    return F.card(
      "隊員身分已確認",
      [
        `${r.name} · ${role === "coach" ? "教練" : "隊員"}`,
        "現在可以在群組卡片上報名。",
      ],
      [F.postback("查看比賽", "matches", { kind: "attendance" })],
    );
  }
  async adminMenu(c: Context) {
    this.admin(c);
    return F.card(
      "隊長管理",
      [
        "群組可見的內容僅限這個群組。",
        "先確認綁定申請的本人，禁止只憑同名核准。",
        "賽前提醒預設關閉，啟用後會使用主動推播額度。",
      ],
      [
        F.postback("建立比賽", "create"),
        F.postback("待確認身分", "pending"),
        F.postback("比賽與提醒", "matches", { kind: "admin" }),
        F.postback("功能選單", "menu"),
      ],
    );
  }
  async pending(c: Context) {
    this.admin(c);
    const rows = await this.store.all<{
      id: string;
      name: string;
      display_name: string;
    }>(
      "SELECT id,name,display_name FROM bot_binding_requests WHERE group_id=? AND status='pending' ORDER BY at LIMIT 10",
      c.group,
    );
    return rows.length
      ? F.flex("待確認身分", {
          type: "carousel",
          contents: rows.map((r) =>
            F.bubble(
              r.name,
              [
                `${r.display_name} 的申請`,
                `編號 ${r.id.slice(0, 8)}；請核對本人。`,
              ],
              [
                F.postback("核准為隊員", "approve", {
                  id: r.id,
                  role: "player",
                }),
                F.postback("核准為教練", "approve", {
                  id: r.id,
                  role: "coach",
                }),
                F.postback("拒絕", "reject", { id: r.id }),
              ],
            ),
          ),
        })
      : F.card("身分申請", ["目前沒有待確認申請。"]);
  }
  async create(c: Context) {
    this.admin(c);
    const flow = await this.store.flow(
      c.group,
      c.user,
      "create",
      "starts",
      {},
      c.now,
    );
    return this.wizard(flow);
  }
  wizard(flow: Flow): Message {
    const step = flow.step,
      labels: Record<string, string> = {
        starts: "選擇比賽日期時間",
        meet: "選擇集合日期時間",
        deadline: "選擇報名截止時間",
        location: "請在此群組輸入球場地點",
        opponent: "請在此群組輸入對手名稱",
        note: "請在此群組輸入備註（無則輸入「無」）",
      };
    if (step === "confirm") {
      const m = JSON.parse(flow.payload);
      return F.card(
        "確認建立比賽",
        [
          `比賽 ${F.taiwanTime(m.starts)}`,
          `集合 ${F.taiwanTime(m.meet)}`,
          `截止 ${F.taiwanTime(m.deadline)}`,
          `地點 ${m.location}｜對手 ${m.opponent}`,
          m.note || "無備註",
        ],
        [
          F.postback("確認建立", "create-confirm", {
            flow: flow.id,
            v: flow.version,
          }),
          F.postback("取消建立", "cancel", { flow: flow.id, v: flow.version }),
        ],
      );
    }
    return F.card(
      labels[step] || "建立比賽",
      [
        "所有時間採台灣時間（UTC+8）。",
        "這個流程只接受發起隊長的操作；其他隊員同時使用不會修改它。",
      ],
      [
        ...(["starts", "meet", "deadline"].includes(step)
          ? [F.pickerAction("選擇日期時間", flow.id, flow.version)]
          : []),
        F.postback("取消建立", "cancel", { flow: flow.id, v: flow.version }),
      ],
    );
  }
  async date(c: Context, p: URLSearchParams, datetime: string | undefined) {
    this.admin(c);
    const flow = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
    if (
      flow.kind !== "create" ||
      !["starts", "meet", "deadline"].includes(flow.step) ||
      !datetime ||
      !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(datetime)
    )
      throw Error("請使用日期時間選擇器。");
    const value = Date.parse(datetime + ":00+08:00");
    if (
      !Number.isFinite(value) ||
      new Date(value + 8 * 3600000).toISOString().slice(0, 16) !== datetime ||
      value <= c.now
    )
      throw Error("請選擇有效的未來時間。");
    const payload = JSON.parse(flow.payload);
    payload[flow.step] = value;
    if (flow.step !== "starts" && value > payload.starts)
      throw Error("集合與截止時間必須早於比賽時間。");
    const next = await this.store.updateFlow(
      flow,
      { starts: "meet", meet: "deadline", deadline: "location" }[flow.step]!,
      payload,
    );
    return this.wizard(next);
  }
  async wizardText(c: Context, value: string): Promise<Message | null> {
    const flow = await this.store.one<Flow>(
      "SELECT * FROM bot_flows WHERE group_id=? AND user_id=? AND kind='create' AND expires>?",
      c.group,
      c.user,
      c.now,
    );
    if (!flow || !["location", "opponent", "note"].includes(flow.step))
      return null;
    this.admin(c);
    const input = value.trim();
    if (!input || input.length > (flow.step === "note" ? 500 : 100))
      throw Error("欄位不可空白或過長。");
    const payload = JSON.parse(flow.payload);
    payload[flow.step] = input === "無" ? "" : input;
    if (flow.step !== "note" && !payload[flow.step])
      throw Error("地點與對手不可空白。");
    const next = await this.store.updateFlow(
      flow,
      { location: "opponent", opponent: "note", note: "confirm" }[flow.step]!,
      payload,
    );
    return this.wizard(next);
  }
  async createConfirm(c: Context, p: URLSearchParams) {
    this.admin(c);
    const f = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
    if (f.kind !== "create" || f.step !== "confirm")
      throw Error("請先完成所有比賽欄位。");
    const b = JSON.parse(f.payload) as Omit<
      Match,
      "id" | "group_id" | "created_by" | "reminders"
    >;
    if (
      b.deadline <= c.now ||
      b.starts <= b.deadline ||
      !b.location ||
      !b.opponent
    )
      throw Error("賽程或截止時間已失效，請重新建立。");
    const m: Match = {
      ...b,
      id: crypto.randomUUID(),
      group_id: c.group,
      created_by: c.user,
      reminders: 0,
    };
    const results = await this.store.db.batch([
      this.store.statement(
        "INSERT INTO bot_matches SELECT ?,?,?,?,?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM bot_flows WHERE id=? AND version=? AND step='confirm')",
        m.id,
        m.group_id,
        m.starts,
        m.meet,
        m.deadline,
        m.location,
        m.opponent,
        m.note,
        m.created_by,
        f.id,
        f.version,
      ),
      this.store.statement(
        "DELETE FROM bot_flows WHERE id=? AND version=?",
        f.id,
        f.version,
      ),
    ]);
    if (!results[0].meta.changes) throw Error("建立操作已處理。");
    await this.audit(c, "create-match", m.id);
    return this.matchMessage(c, m);
  }
  async matches(c: Context, kind: string, page = 0) {
    if (!["attendance", "lineup", "admin"].includes(kind))
      throw Error("未知的比賽功能。");
    if (kind === "admin") this.admin(c);
    const rows = await this.store.all<Match>(
      "SELECT * FROM bot_matches WHERE group_id=? AND starts>? ORDER BY starts",
      c.group,
      c.now - 86400000,
    );
    const shown = rows.slice(page * 8, page * 8 + 8);
    if (!shown.length)
      return F.card(
        "比賽賽程",
        ["目前尚無近期比賽，請隊長建立。"],
        c.role === "admin"
          ? [F.postback("建立比賽", "create")]
          : [F.postback("回選單", "menu")],
      );
    return F.flex(
      "選擇比賽",
      {
        type: "carousel",
        contents: shown.map((m) =>
          F.bubble(
            `vs ${m.opponent}`,
            [F.taiwanTime(m.starts), m.location],
            kind === "lineup"
              ? [
                  F.postback("10 棒推薦", "lineup", { id: m.id, size: 10 }),
                  F.postback("11 棒 DH", "lineup", { id: m.id, size: 11 }),
                ]
              : kind === "admin"
                ? [
                    F.postback("報名名單", "match", { id: m.id }),
                    F.postback(
                      m.reminders ? "停用賽前提醒" : "啟用賽前提醒",
                      "reminders",
                      { id: m.id, on: m.reminders ? 0 : 1 },
                    ),
                  ]
                : [F.postback("報名與出席名單", "match", { id: m.id })],
          ),
        ),
      },
      [
        ...(page > 0
          ? [F.postback("上一頁", "matches", { kind, page: page - 1 })]
          : []),
        ...((page + 1) * 8 < rows.length
          ? [F.postback("下一頁", "matches", { kind, page: page + 1 })]
          : []),
        F.postback("選單", "menu"),
      ],
    );
  }
  async attend(c: Context, p: URLSearchParams) {
    this.member(c);
    const m = await this.match(c, p.get("id") || "");
    const status = p.get("status");
    if (!["yes", "maybe", "no"].includes(status || ""))
      throw Error("報名狀態無效。");
    if (c.now >= m.deadline) throw Error("這場報名已截止。");
    const r = await this.store.run(
      `INSERT INTO bot_attendance(match_id,user_id,status,updated_at,event_id,version)
      SELECT ?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM bot_matches WHERE id=? AND group_id=? AND deadline>?) AND EXISTS(SELECT 1 FROM bot_members WHERE group_id=? AND user_id=? AND active=1)
      ON CONFLICT(match_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,event_id=excluded.event_id,version=bot_attendance.version+1 WHERE excluded.updated_at>bot_attendance.updated_at`,
      m.id,
      c.user,
      status,
      c.timestamp,
      c.eventId,
      m.id,
      c.group,
      c.now,
      c.group,
      c.user,
    );
    if (!r.meta.changes)
      throw Error("較新的報名已保存，或報名已截止；請更新名單確認。");
    await this.audit(c, "attendance", m.id);
    return this.matchMessage(c, m);
  }
  async lineup(c: Context, p: URLSearchParams) {
    this.statsAllowed();
    const m = await this.match(c, p.get("id") || ""),
      size = Number(p.get("size"));
    if (![10, 11].includes(size)) throw Error("請選擇 10 棒或 11 棒。");
    const roster = await this.roster(c, m);
    if (roster.names.yes.length < size)
      throw Error(
        `已出席 ${roster.names.yes.length} 人，未滿 ${size} 棒，請先完成報名。`,
      );
    const snapshot = await this.snapshot(),
      e = engine(snapshot, { present: roster.names.yes, size });
    const unknown = roster.names.yes.filter(
      (n) => !e.allPlayers().some((p) => p.name === n),
    );
    if (unknown.length)
      throw Error("部分已出席球員尚未在正式網站建檔，請隊長確認。");
    const result = e.recommend();
    if (result.items.length !== size)
      throw Error("正式模型未能組成完整打線，請檢查名單與守位。");
    const id = crypto.randomUUID(),
      fingerprint = digest([snapshot.digest, roster.names.yes.slice().sort()]);
    await this.store.run(
      "INSERT INTO bot_lineups VALUES(?,?,?,?,?,?,?)",
      id,
      m.id,
      c.group,
      JSON.stringify(result),
      fingerprint,
      null,
      c.now,
    );
    return F.lineupCard(m, result, id);
  }
  async confirmLineup(c: Context, id: string) {
    this.coach(c);
    const row = await this.store.one<{
      id: string;
      match_id: string;
      payload: string;
      fingerprint: string;
      confirmed_by: string | null;
      created: number;
    }>("SELECT * FROM bot_lineups WHERE id=? AND group_id=?", id, c.group);
    if (!row || row.created < c.now - 900000)
      throw Error("推薦已過期，請重新推薦。");
    if (row.confirmed_by) throw Error("這份打線已確認。");
    const m = await this.match(c, row.match_id),
      roster = await this.roster(c, m),
      snapshot = await this.snapshot();
    if (
      row.fingerprint !==
      digest([snapshot.digest, roster.names.yes.slice().sort()])
    )
      throw Error("出席或正式數據已更新，請重新推薦後確認。");
    const updated = await this.store.run(
      `UPDATE bot_lineups SET confirmed_by=? WHERE id=? AND confirmed_by IS NULL AND (SELECT json_group_array(name) FROM (SELECT b.name FROM bot_members b JOIN bot_attendance a ON a.user_id=b.user_id WHERE b.group_id=? AND b.active=1 AND a.match_id=? AND a.status='yes' ORDER BY b.name))=?`,
      c.user,
      row.id,
      c.group,
      m.id,
      JSON.stringify(roster.names.yes.slice().sort()),
    );
    if (!updated.meta.changes) throw Error("已有教練確認。");
    await this.audit(c, "confirm-lineup", id);
    return F.lineupCard(m, JSON.parse(row.payload) as Lineup, id, true);
  }
  async reports(c: Context, page: number) {
    this.statsAllowed();
    const e = engine(await this.snapshot()),
      games = e.games(),
      shown = games.slice(page * 8, page * 8 + 8);
    if (!shown.length) return F.card("賽後戰報", ["目前沒有已完賽場記。"]);
    return F.flex(
      "選擇賽後戰報",
      {
        type: "carousel",
        contents: shown.map((g) =>
          F.bubble(
            `${g.date} vs ${g.opponent}`,
            ["讀取正式場記與原網站 MVP／生涯紀錄算法。"],
            [F.postback("查看圖形化戰報", "report", { id: g.id })],
          ),
        ),
      },
      [
        ...(page > 0
          ? [F.postback("上一頁", "reports", { page: page - 1 })]
          : []),
        ...((page + 1) * 8 < games.length
          ? [F.postback("下一頁", "reports", { page: page + 1 })]
          : []),
        F.postback("選單", "menu"),
      ],
    );
  }
  async reminderSettings(c: Context, p: URLSearchParams) {
    this.admin(c);
    const m = await this.match(c, p.get("id") || ""),
      on = p.get("on") === "1";
    if (on && this.env.ENABLE_PUSH !== "true")
      throw Error("擁有者尚未啟用主動推播與額度設定，無法開啟提醒。");
    await this.store.run(
      "UPDATE bot_matches SET reminders=? WHERE id=? AND group_id=?",
      on ? 1 : 0,
      m.id,
      c.group,
    );
    if (on) {
      for (const [kind, due] of [
        ["day", m.starts - 86400000],
        ["hour", m.starts - 3600000],
      ] as const)
        if (due > c.now)
          await this.store.run(
            "INSERT INTO bot_outbox(id,match_id,group_id,kind,due,status,retry_key,attempts) VALUES(?,?,?,?,?,'pending',?,0) ON CONFLICT(match_id,kind) DO UPDATE SET status='pending',due=excluded.due,retry_key=excluded.retry_key,attempts=0,claimed_at=NULL,reserved=0 WHERE bot_outbox.status='cancelled'",
            crypto.randomUUID(),
            m.id,
            c.group,
            kind,
            due,
            crypto.randomUUID(),
          );
    } else
      await this.store.run(
        "UPDATE bot_outbox SET status='cancelled' WHERE match_id=? AND status IN ('pending','retry')",
        m.id,
      );
    await this.audit(c, on ? "enable-reminders" : "disable-reminders", m.id);
    return F.card("賽前提醒設定", [
      on
        ? "已啟用賽前 24 小時與 1 小時提醒（尚未過期的時點）。"
        : "已停用後續提醒。",
      "提醒只會發到這個群組；受擁有者開關、官方額度與本機預算限制。",
    ]);
  }
  async dispatch(
    c: Context,
    p: URLSearchParams,
    datetime?: string,
  ): Promise<Message> {
    const a = p.get("a");
    switch (a) {
      case "menu":
        await this.store.run(
          "DELETE FROM bot_flows WHERE group_id=? AND user_id=?",
          c.group,
          c.user,
        );
        return F.menu();
      case "pick":
        return this.choose(c, p.get("kind") || "");
      case "pick-page": {
        const f = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
        if (!["stats", "compare", "bind"].includes(f.kind))
          throw Error("未知選擇卡");
        if (f.kind !== "bind") this.statsAllowed();
        const s = await this.snapshot(),
          e = engine(s);
        let players = e.players();
        if (f.kind === "compare" && f.step === "second")
          players = players.filter(
            (x) => playerKey(x.name) !== JSON.parse(f.payload).first,
          );
        return F.playerPicker(
          players,
          e.jersey,
          s.avatars,
          f.id,
          f.version,
          this.page(p),
          f.kind,
        );
      }
      case "select":
        return this.selected(c, p);
      case "bind-request":
        return this.bindRequest(c, p);
      case "approve":
        return this.approve(c, p);
      case "reject":
        return this.approve(c, p, true);
      case "admin":
        return this.adminMenu(c);
      case "pending":
        return this.pending(c);
      case "create":
        return this.create(c);
      case "date":
        return this.date(c, p, datetime);
      case "create-confirm":
        return this.createConfirm(c, p);
      case "cancel": {
        const f = await this.getFlow(c, p.get("flow") || "", p.get("v") || "");
        await this.store.run(
          "DELETE FROM bot_flows WHERE id=? AND version=?",
          f.id,
          f.version,
        );
        return F.card("已取消操作", ["沒有建立或修改正式賽事資料。"]);
      }
      case "matches":
        return this.matches(c, p.get("kind") || "attendance", this.page(p));
      case "match":
        return this.matchMessage(c, await this.match(c, p.get("id") || ""));
      case "attend":
        return this.attend(c, p);
      case "lineup":
        return this.lineup(c, p);
      case "confirm-lineup":
        return this.confirmLineup(c, p.get("id") || "");
      case "reports":
        return this.reports(c, this.page(p));
      case "report": {
        this.statsAllowed();
        const e = engine(await this.snapshot()),
          game = e.games().find((g) => g.id === p.get("id"));
        if (!game) throw Error("正式場記不存在或尚未完賽。");
        return F.reportCard(game, e.report(game));
      }
      case "rank": {
        this.statsAllowed();
        const metric = p.get("metric") || "ops";
        if (!F.metricKeys.includes(metric as (typeof F.metricKeys)[number]))
          throw Error("排行榜指標無效。");
        const choice = p.get("min") || "auto";
        if (!["auto", "0", "14", "30"].includes(choice))
          throw Error("最低 PA 門檻無效。");
        const e = engine(await this.snapshot());
        const min =
          choice === "auto"
            ? ["h", "hr", "pa"].includes(metric)
              ? 0
              : e.minimumPa()
            : Number(choice);
        return F.ranking(e.players(), metric, min, choice, this.page(p));
      }
      case "reminders":
        return this.reminderSettings(c, p);
      default:
        throw Error("這個按鈕已失效，請重新輸入「選單」。");
    }
  }
  page(p: URLSearchParams) {
    const page = Number(p.get("page") || 0);
    if (!Number.isInteger(page) || page < 0 || page > 100)
      throw Error("頁碼無效");
    return page;
  }
}
