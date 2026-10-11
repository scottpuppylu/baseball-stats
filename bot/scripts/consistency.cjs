// Independent browser oracle: actual website functions vs the generated bot engine.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const sha = (file) =>
  require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
(async () => {
  const net = require("node:net");
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const preview = spawn(process.execPath, ["tests/ui-preview-server.cjs"], {
    cwd: root,
    env: { ...process.env, UI_PREVIEW_PORT: String(port) },
    stdio: "ignore",
  });
  const officialFiles = fs
    .readdirSync(path.join(root, "data"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(root, "data", f));
  const before = officialFiles.map(sha);
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await page.route(
      /https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,
      (r) => r.abort(),
    );
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(
      () =>
        window.teamInsights &&
        window.LineupModel &&
        allLogs.some((l) => String(l.id).startsWith("log_game_")),
    );
    const snapshot = Object.fromEntries(
      ["logs", "games", "defense", "avatars"].map((n) => [
        n,
        JSON.parse(
          fs.readFileSync(
            path.join(root, "tests/fixtures/data", n + ".json"),
            "utf8",
          ),
        ),
      ]),
    );
    snapshot.guests = [];
    const { createEngine } = await import("../generated/engine.mjs");
    const e = createEngine(snapshot);
    const original = await page.evaluate(() => ({
      players: getAnalysisAgg().players,
      full: getFullAgg().players,
      min: rateQualifyingPa(getAnalysisAgg().players),
      logs: allLogs,
    }));
    // JSON normalizes browser structured-clone vs module NaN/undefined representations.
    const clean = (x) => JSON.parse(JSON.stringify(x));
    assert.deepEqual(clean(e.players()), clean(original.players));
    assert.deepEqual(clean(e.allPlayers()), clean(original.full));
    assert.equal(e.minimumPa(), original.min);
    assert.deepEqual(clean(e.logs()), clean(original.logs));
    const present = original.full.slice(0, 12).map((p) => p.name);
    const reports = [];
    let maximumNumericDelta = 0;
    function equivalent(a, b, at = "result") {
      if (typeof a === "number" && typeof b === "number") {
        const delta = Math.abs(a - b);
        maximumNumericDelta = Math.max(maximumNumericDelta, delta);
        assert.ok(
          delta <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)),
          `${at}: ${a} != ${b}`,
        );
        return;
      }
      if (a && b && typeof a === "object" && typeof b === "object") {
        assert.deepEqual(Object.keys(a), Object.keys(b), at);
        for (const k of Object.keys(a)) equivalent(a[k], b[k], `${at}.${k}`);
      } else assert.deepEqual(a, b, at);
    }
    for (const size of [10, 11])
      for (const locked of [false, true]) {
        const locks = locked ? { [present[0]]: 2 } : {};
        const actual = createEngine(snapshot, {
          present,
          size,
          locks,
        }).recommend();
        const expected = await page.evaluate(
          ({ present, size, locks }) => {
            presentPlayersSet = new Set(present);
            attendanceInitialized = true;
            attendanceEdited = true;
            isDhEnabled = size === 11;
            localStorage.setItem(
              "rebas_lineup_sim_settings",
              JSON.stringify({
                timeLimit: 90,
                maxInnings: 7,
                rule: "noNewInning",
              }),
            );
            localStorage.setItem("rebas_lineup_locks", JSON.stringify(locks));
            return calculateRecommendedLineup(getFullAgg().players);
          },
          { present, size, locks },
        );
        equivalent(clean(actual), clean(expected));
        reports.push({
          size,
          locked,
          runs: actual.model.runs,
          order: actual.items.map((i) => i.player.name),
        });
      }
    let recent = 0,
      career = 0;
    for (const p of e.players()) {
      const expected = await page.evaluate((name) => {
        const g = teamInsights.playerGames(name, allLogs);
        return {
          recent: g
            .filter((x) => !x.summary)
            .slice(-5)
            .reverse(),
          milestones: teamInsights.milestones(g),
          streaks: teamInsights.streaks(g),
        };
      }, p.name);
      assert.deepEqual(clean(e.recent(p.name)), clean(expected.recent));
      recent++;
      assert.deepEqual(
        clean(e.career(p.name).milestones),
        clean(expected.milestones),
      );
      assert.deepEqual(
        clean(e.career(p.name).streaks),
        clean(expected.streaks),
      );
      career++;
    }
    for (const g of e.games()) {
      const expected = await page.evaluate((id) => {
        const g = allGames.find((x) => x.id === id),
          summary = teamInsights.gameSummary(g);
        return {
          summary,
          mvp: teamInsights.gameMvp(g, summary.rows),
          records: teamInsights.gameRecords(g, summary.rows),
          scored: isGameScoreRecorded(g),
        };
      }, g.id);
      assert.deepEqual(clean(e.report(g)), clean(expected));
    }
    assert.deepEqual(officialFiles.map(sha), before, "formal data unchanged");
    assert.equal(
      await page.evaluate(() => window.__previewWrites.length),
      0,
      "no website write on load",
    );
    const result = {
      ok: true,
      players: e.players().length,
      minimumPa: e.minimumPa(),
      recent,
      career,
      gameReports: e.games().length,
      lineups: reports,
      maximumNumericDelta,
      tolerance: 1e-12,
      formalDataUnchanged: true,
      productionNetwork: false,
    };
    fs.mkdirSync(path.join(root, ".local"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".local/line-consistency.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
