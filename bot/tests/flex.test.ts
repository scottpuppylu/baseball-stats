import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../src/types";
import { fixture, actions, group, alice, owner } from "./helpers";
import * as F from "../src/flex";
import { engine, playerKey } from "../src/source";
function validate(message: Message) {
  assert.equal(message.type, "flex");
  if (message.type !== "flex") return;
  assert.ok(message.altText.length <= 400);
  assert.ok((message.quickReply?.items?.length || 0) <= 13);
  const bubbles =
    message.contents.type === "carousel"
      ? message.contents.contents
      : [message.contents];
  assert.ok(bubbles.length >= 1 && bubbles.length <= 12);
  for (const b of bubbles) {
    assert.ok(Buffer.byteLength(JSON.stringify(b)) <= 30000);
    assert.equal(b.type, "bubble");
    assert.ok(b.body?.contents.length);
  }
  for (const a of actions(message)) {
    assert.ok(a.data.length <= 300);
    assert.ok((a.label?.length || 0) <= 20);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < 50000);
}
test("six native Flex entry points, Quick Replies and every feature payload satisfy local bounds", async () => {
  const f = fixture();
  try {
    const s = await (await import("./helpers")).snapshot(),
      e = engine(s);
    validate(F.menu());
    assert.equal(
      actions(F.menu()).filter(
        (a) =>
          ["pick", "rank", "matches", "reports"].includes(
            new URLSearchParams(a.data).get("a") || "",
          ) && new URLSearchParams(a.data).get("kind") !== "bind",
      ).length,
      6,
    );
    const player = e.players()[0];
    validate(
      F.playerPicker(e.players(), e.jersey, s.avatars, "flow", 1, 0, "stats"),
    );
    validate(
      F.playerCard(
        player,
        e.jersey(player.name),
        e.recent(player.name),
        e.career(player.name),
        s.avatars[player.name],
      ),
    );
    for (const metric of F.metricKeys)
      validate(F.ranking(e.players(), metric, e.minimumPa(), "auto", 0));
    validate(F.comparison(e.players()[0], e.players()[1]));
    const m = await f.addMatch();
    validate(
      await f.bot.controller.matchMessage(
        {
          group,
          user: owner,
          role: "admin",
          member: null,
          eventId: "test",
          replyToken: "test",
          now: f.now(),
          timestamp: f.now(),
        },
        m,
      ),
    );
    const result = engine(s, {
      present: e.players().map((p) => p.name),
      size: 11,
    }).recommend();
    validate(F.lineupCard(m, result, "test-lineup"));
    validate(F.reportCard(e.games()[0], e.report(e.games()[0])));
    assert.equal(
      JSON.stringify(
        F.playerCard(
          player,
          e.jersey(player.name),
          [],
          e.career(player.name),
          "data:image/png;base64,test",
        ),
      ).includes("data:image"),
      false,
    );
    assert.equal(playerKey(player.name).length, 20);
  } finally {
    f.close();
  }
});
