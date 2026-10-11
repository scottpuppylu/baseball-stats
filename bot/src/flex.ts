import type { messagingApi } from "@line/bot-sdk";
import type {
  Message,
  Player,
  Match,
  Lineup,
  Game,
  GameReport,
  Career,
} from "./types";
import { playerKey } from "./source";
type Action = messagingApi.Action;
type Component = messagingApi.FlexComponent;
const cut = (value: unknown, max = 1000) =>
  String(value ?? "").slice(0, max) || "—";
export const data = (
  a: string,
  params: Record<string, string | number> = {},
) => {
  const out = new URLSearchParams({
    a,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  }).toString();
  if (out.length > 300) throw Error("Postback 超過官方長度限制");
  return out;
};
export const postback = (
  label: string,
  a: string,
  params: Record<string, string | number> = {},
): Action => ({
  type: "postback",
  label: cut(label, 20),
  data: data(a, params),
});
export const pickerAction = (
  label: string,
  flow: string,
  version: number,
): Action => ({
  type: "datetimepicker",
  label: cut(label, 20),
  data: data("date", { flow, v: version }),
  mode: "datetime",
});
const text = (
  value: unknown,
  size: messagingApi.FlexText["size"] = "sm",
  color = "#CBD5E1",
): messagingApi.FlexText => ({
  type: "text",
  text: cut(value),
  wrap: true,
  size,
  color,
});
const button = (action: Action): messagingApi.FlexButton => ({
  type: "button",
  style: "primary",
  color: "#206B8B",
  height: "sm",
  action,
});
export function bubble(
  title: string,
  lines: string[],
  actions: Action[] = [],
): messagingApi.FlexBubble {
  return {
    type: "bubble",
    size: "mega",
    styles: {
      header: { backgroundColor: "#10243A" },
      body: { backgroundColor: "#142A40" },
      footer: { backgroundColor: "#142A40" },
    },
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        text("淡江航太系壘", "xs", "#7DD3FC"),
        { ...text(title, "xl", "#FFFFFF"), weight: "bold" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: lines.length ? lines.map((l) => text(l)) : [text("請選擇功能")],
    },
    ...(actions.length
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: actions.map(button),
          },
        }
      : {}),
  };
}
export function flex(
  title: string,
  contents: messagingApi.FlexContainer,
  quick: Action[] = [],
): Message {
  return {
    type: "flex",
    altText: cut(title, 400),
    contents,
    ...(quick.length
      ? {
          quickReply: {
            items: quick
              .slice(0, 13)
              .map((action) => ({ type: "action", action })),
          },
        }
      : {}),
  };
}
export const card = (
  title: string,
  lines: string[],
  actions: Action[] = [],
): Message => flex(title, bubble(title, lines, actions));
export const failure = (message: string): Message =>
  card("操作提醒", [message], [postback("重新開啟選單", "menu")]);
export function menu(): Message {
  return flex(
    "淡江航太系壘｜六大功能",
    {
      type: "carousel",
      contents: [
        bubble(
          "數據與表現",
          ["群組內直接選球員，查看正式網站數據。"],
          [
            postback("個人數據", "pick", { kind: "stats" }),
            postback("球隊排行榜", "rank", {
              metric: "ops",
              min: "auto",
              page: 0,
            }),
            postback("球員比較", "pick", { kind: "compare" }),
          ],
        ),
        bubble(
          "比賽與球隊",
          ["由隊長建立賽程；隊員一鍵報名。"],
          [
            postback("智慧排棒", "matches", { kind: "lineup" }),
            postback("比賽報名", "matches", { kind: "attendance" }),
            postback("賽後戰報", "reports", { page: 0 }),
          ],
        ),
      ],
    },
    [
      postback("申請身分綁定", "pick", { kind: "bind" }),
      postback("隊長管理", "admin"),
    ],
  );
}
export function playerPicker(
  players: Player[],
  jersey: (name: string) => number | null,
  avatars: Record<string, string>,
  flow: string,
  version: number,
  page: number,
  kind: string,
): Message {
  const start = page * 6,
    contents = players.slice(start, start + 6).map((p) => {
      const b = bubble(
        `${p.name} #${jersey(p.name) ?? "—"}`,
        [`PA ${p.pa}｜AVG ${p.avg.toFixed(3)}｜OPS ${p.ops.toFixed(3)}`],
        [
          postback(
            kind === "bind" ? "申請綁定這位球員" : "選擇球員",
            "select",
            { flow, v: version, p: playerKey(p.name) },
          ),
        ],
      );
      const avatar = avatars[p.name];
      if (avatar && /^https:\/\//.test(avatar) && avatar.length <= 2000)
        b.hero = {
          type: "image",
          url: avatar,
          size: "full",
          aspectRatio: "1:1",
          aspectMode: "cover",
        };
      return b;
    });
  if (!contents.length) return failure("目前沒有正式球員數據。");
  const quick = [postback("回到選單", "menu")];
  if (page > 0)
    quick.push(
      postback("上一頁", "pick-page", { flow, v: version, page: page - 1 }),
    );
  if (start + 6 < players.length)
    quick.push(
      postback("下一頁", "pick-page", { flow, v: version, page: page + 1 }),
    );
  return flex(
    `選擇球員｜第 ${page + 1} 頁`,
    { type: "carousel", contents },
    quick,
  );
}
export function playerCard(
  p: Player,
  jersey: number | null,
  recent: { date: string; tag: string; stats: Player }[],
  career: Career,
  avatar: string | undefined,
): Message {
  const lines = [
    `背號 ${jersey ?? "—"}｜PA ${p.pa} · AB ${p.ab} · H ${p.h} · HR ${p.hr}`,
    `AVG ${p.avg.toFixed(3)} · OBP ${p.obp.toFixed(3)}`,
    `SLG ${p.slg.toFixed(3)} · OPS ${p.ops.toFixed(3)}`,
    `wRC+ ${p.wrc_plus.toFixed(1)} · wOBA ${p.woba.toFixed(3)}`,
    "最近五場",
    ...recent.map(
      (g) =>
        `${g.date}｜${g.stats.h}/${g.stats.ab} · OPS ${g.stats.ops.toFixed(3)}`,
    ),
    ...(!recent.length ? ["沒有逐場紀錄；年度彙總不當作單場。"] : []),
    "生涯紀錄",
    ...career.highs.map((h) => `${h.key}單場最高 ${h.value}（${h.date}）`),
    ...career.milestones.slice(-3).map((m) => `${m.date} ${m.text}`),
    `連續安打 ${career.streaks.hit} 場；最佳 ${career.streaks.bestHit} 場`,
    p.pa < 20
      ? "⚠️ 未滿 20 PA，率指標容易波動。"
      : "wRC+ 沿用隊內相對值，隊均 100。",
  ];
  const b = bubble(p.name, lines, [
    postback("查其他球員", "pick", { kind: "stats" }),
  ]);
  if (avatar && /^https:\/\//.test(avatar) && avatar.length <= 2000)
    b.hero = {
      type: "image",
      url: avatar,
      size: "full",
      aspectRatio: "1:1",
      aspectMode: "cover",
    };
  return flex(`${p.name} 個人數據`, b, [postback("選單", "menu")]);
}
export const metricKeys = [
  "avg",
  "ops",
  "obp",
  "slg",
  "wrc_plus",
  "h",
  "hr",
  "pa",
] as const;
export const metricLabel = (k: string) =>
  k === "wrc_plus" ? "wRC+" : k.toUpperCase();
export function metricValue(p: Player, k: string) {
  const n = Number(p[k]) || 0;
  return ["h", "hr", "pa"].includes(k)
    ? String(n)
    : k === "wrc_plus"
      ? n.toFixed(1)
      : n.toFixed(3);
}
export function ranking(
  players: Player[],
  metric: string,
  min: number,
  minChoice: string,
  page: number,
): Message {
  const sorted = players
    .filter((p) => p.pa >= min)
    .sort(
      (a, b) =>
        Number(b[metric]) - Number(a[metric]) ||
        b.pa - a.pa ||
        a.name.localeCompare(b.name),
    );
  const pageItems = sorted.slice(page * 10, page * 10 + 10),
    lines = [
      `最低 PA：${min}（${minChoice === "auto" ? "沿用原網站門檻" : "自選門檻"}）`,
      "前三名",
      ...sorted
        .slice(0, 3)
        .map(
          (p, i) =>
            `${["🥇", "🥈", "🥉"][i]} ${p.name} ${metricValue(p, metric)} (${p.pa} PA)`,
        ),
      `完整榜單 · ${page + 1} / ${Math.max(1, Math.ceil(sorted.length / 10))}`,
      ...pageItems.map(
        (p, i) =>
          `${page * 10 + i + 1}. ${p.name}｜${metricValue(p, metric)}｜PA ${p.pa}`,
      ),
    ];
  if (!sorted.length) lines.push("無人達到目前打席門檻。");
  const actions: Action[] = [];
  if (page > 0)
    actions.push(
      postback("上一頁", "rank", { metric, min: minChoice, page: page - 1 }),
    );
  if ((page + 1) * 10 < sorted.length)
    actions.push(
      postback("下一頁", "rank", { metric, min: minChoice, page: page + 1 }),
    );
  return flex(
    `${metricLabel(metric)} 球隊排行`,
    bubble(`${metricLabel(metric)} 球隊排行`, lines, actions),
    [
      ...metricKeys.map((k) =>
        postback(metricLabel(k), "rank", {
          metric: k,
          min: minChoice,
          page: 0,
        }),
      ),
      postback("原網站 PA 門檻", "rank", { metric, min: "auto", page: 0 }),
      postback("全部 PA", "rank", { metric, min: "0", page: 0 }),
      postback("PA ≥14", "rank", { metric, min: "14", page: 0 }),
      postback("PA ≥30", "rank", { metric, min: "30", page: 0 }),
      postback("選單", "menu"),
    ],
  );
}
export function comparison(a: Player, b: Player): Message {
  const lines = [
    `${a.name} ${a.pa} PA｜${b.name} ${b.pa} PA`,
    ...["avg", "obp", "slg", "ops", "wrc_plus", "bb_pct", "k_pct"].map((k) => {
      const av = Number(a[k]),
        bv = Number(b[k]),
        val = (n: number) =>
          k.endsWith("_pct")
            ? `${(n * 100).toFixed(1)}%`
            : k === "wrc_plus"
              ? n.toFixed(1)
              : n.toFixed(3);
      const winner =
        av === bv
          ? "持平"
          : (k === "k_pct" ? av < bv : av > bv)
            ? a.name
            : b.name;
      return `${k.endsWith("_pct") ? (k === "k_pct" ? "K%" : "BB%") : metricLabel(k)} ${val(av)} / ${val(bv)} · ${winner}${winner === "持平" ? "" : " 優勢"}`;
    }),
    Math.min(a.pa, b.pa) < 20
      ? "⚠️ 至少一人未滿 20 PA，差異可能只是樣本波動。"
      : "樣本與對手不同，數值差異不代表未來保證。",
    "K% 以較低者為佳。",
  ];
  return card(`${a.name} vs ${b.name}`, lines, [
    postback("重新比較", "pick", { kind: "compare" }),
    postback("選單", "menu"),
  ]);
}
export const taiwanTime = (ms: number) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
export function matchCard(
  m: Match,
  counts: { yes: number; maybe: number; no: number; pending: number },
  names: Record<string, string[]>,
  closed: boolean,
): Message {
  return card(
    `vs ${m.opponent}`,
    [
      `比賽 ${taiwanTime(m.starts)}`,
      `集合 ${taiwanTime(m.meet)}｜${m.location}`,
      `截止 ${taiwanTime(m.deadline)}`,
      m.note || "無備註",
      `✅ ${counts.yes} 出席｜❓ ${counts.maybe} 待定｜❌ ${counts.no} 請假`,
      `出席：${names.yes.join("、") || "—"}`,
      `待定：${names.maybe.join("、") || "—"}`,
      `請假：${names.no.join("、") || "—"}`,
      `未回覆 ${counts.pending}：${names.pending.join("、") || "—"}`,
      closed ? "報名已截止。" : "點選後可再修改自己的狀態。",
    ],
    closed
      ? [postback("更新名單", "match", { id: m.id })]
      : [
          postback("✅ 出席", "attend", { id: m.id, status: "yes" }),
          postback("❓ 待定", "attend", { id: m.id, status: "maybe" }),
          postback("❌ 請假", "attend", { id: m.id, status: "no" }),
          postback("更新名單", "match", { id: m.id }),
        ],
  );
}
export function lineupCard(
  m: Match,
  result: Lineup,
  id: string,
  confirmed = false,
): Message {
  const contents = [
    bubble(
      confirmed ? "教練已確認先發" : "推薦打線 · 待教練確認",
      [
        `${taiwanTime(m.starts)} vs ${m.opponent}`,
        `${result.targetSize} 棒 · 90 分鐘`,
        `預估 ${result.model.runs.toFixed(2)} 分／場（非保證比分）`,
        ...result.model.ignoredLocks,
      ],
      [
        ...(!confirmed ? [postback("教練確認", "confirm-lineup", { id })] : []),
        postback("10 棒重新推薦", "lineup", { id: m.id, size: 10 }),
        postback("11 棒 DH", "lineup", { id: m.id, size: 11 }),
      ],
    ),
  ];
  for (let start = 0; start < result.items.length; start += 4)
    contents.push(
      bubble(
        `第 ${start + 1}–${Math.min(start + 4, result.items.length)} 棒`,
        result.items
          .slice(start, start + 4)
          .flatMap((i) => [
            `${i.slot}. ${i.player.name}｜${i.posInfo.label}`,
            cut(i.reason, 350),
          ]),
      ),
    );
  return flex(
    confirmed ? "教練確認先發打線" : "智慧推薦打線",
    { type: "carousel", contents },
    [postback("選單", "menu")],
  );
}
export function reportCard(g: Game, r: GameReport): Message {
  const total = r.summary.rows.reduce((s, p) => s + p.h, 0),
    bb = r.summary.rows.reduce((s, p) => s + p.bb, 0);
  const lines = [
    `${g.date} vs ${g.opponent}`,
    r.scored
      ? `比分 ${g.finalScore!.us}：${g.finalScore!.opp}`
      : "比分未記錄（不當作 0:0）",
    `全隊 ${total} 安打 · ${bb} 保送`,
    r.mvp ? `★ MVP ${r.mvp.name}｜${r.mvp.line}` : "無足夠 MVP 表現資料",
    ...(r.mvp?.tags || []),
    "主要球員表現",
    ...r.summary.rows
      .filter((p) => p.h || p.bb)
      .sort((a, b) => b.h - a.h || b.bb - a.bb)
      .slice(0, 5)
      .map((p) => `${p.name} ${p.ab}打數${p.h}安打 · ${p.hr}轟 ${p.bb}BB`),
    "本場生涯紀錄更新",
    ...r.records.marks.slice(0, 6),
    ...(!r.records.marks.length ? ["本場無新增可定位的里程碑。"] : []),
  ];
  return card("賽後戰報", lines, [
    postback("其他戰報", "reports", { page: 0 }),
    postback("選單", "menu"),
  ]);
}
