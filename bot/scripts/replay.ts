// Exports real native LINE payloads and exercises complete group flows without network.
import { mkdirSync, writeFileSync } from "node:fs";
import { fixture, actions, owner, alice } from "../tests/helpers";
import { data } from "../src/flex";
import type { Message } from "../src/types";
async function main() {
  const f = fixture();
  mkdirSync(".local/line-flex", { recursive: true });
  const save = (name: string, m: Message | null) => {
    if (!m) throw Error(`${name}: no reply`);
    writeFileSync(`.local/line-flex/${name}.json`, JSON.stringify(m, null, 2));
  };
  try {
    save("menu", (await f.text("選單")).message);
    const pick = await f.post(data("pick", { kind: "stats" }));
    save("player-picker", pick.message);
    save(
      "player-stats",
      (await f.post(actions(pick.message!)[0].data)).message,
    );
    save(
      "leaderboard",
      (await f.post(data("rank", { metric: "ops", min: "auto" }))).message,
    );
    const first = await f.post(data("pick", { kind: "compare" }));
    const second = await f.post(actions(first.message!)[0].data);
    save(
      "comparison",
      (await f.post(actions(second.message!)[0].data)).message,
    );
    const match = await f.addMatch();
    const players = f.players();
    for (let i = 0; i < 12; i++) {
      const u = i === 0 ? alice : "U" + String(i).padStart(32, "0");
      await f.bind(u, players[i].name);
      await f.post(data("attend", { id: match.id, status: "yes" }), u);
    }
    save("attendance", (await f.post(data("match", { id: match.id }))).message);
    for (const size of [10, 11]) {
      const rec = await f.post(data("lineup", { id: match.id, size }));
      save(`lineup-${size}`, rec.message);
      const a = actions(rec.message!).find(
        (a) => new URLSearchParams(a.data).get("a") === "confirm-lineup",
      )!;
      save(`lineup-${size}-confirmed`, (await f.post(a.data, owner)).message);
    }
    const games = await f.post(data("reports", { page: 0 }));
    save("report-picker", games.message);
    save("postgame", (await f.post(actions(games.message!)[0].data)).message);
    console.log(
      "12 native Flex payloads exported to .local/line-flex. Isolated SQLite + mock transport; no real group notifications.",
    );
  } finally {
    f.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
