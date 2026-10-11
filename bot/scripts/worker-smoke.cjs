const { spawn, spawnSync } = require("node:child_process");
const { createHmac, randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const config = "bot/tests/wrangler-smoke.jsonc";
const persist = path.join(root, ".local/line-d1-smoke", randomUUID());
(async () => {
  const init = spawnSync(
    process.execPath,
    [
      cli,
      "d1",
      "execute",
      "line-bot-isolated-smoke",
      "--local",
      "--config",
      config,
      "--persist-to",
      persist,
      "--file",
      "bot/schema.sql",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (init.status !== 0) throw Error(init.stderr || init.stdout);
  const port = await new Promise((r) => {
    const s = require("node:net")
      .createServer()
      .listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => r(p));
      });
  });
  const server = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      persist,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(base + "/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw Error("local worker failed: " + log.slice(-2500));
    assert.equal((await(await fetch(base+'/production/health')).json()).configured,true);
    const empty=JSON.stringify({events:[]});
    assert.equal((await fetch(base+'/production/webhook',{method:'POST',body:empty,headers:{'x-line-signature':createHmac('sha256','isolated-worker-secret').update(empty).digest('base64')}})).status,200);
    assert.equal((await fetch(base + "/seed", { method: "POST" })).status, 200);
    const group = "C" + "1".repeat(32),
      alice = "U" + "b".repeat(32),
      bob = "U" + "c".repeat(32);
    const event = (user, data) => ({
      type: data ? "postback" : "message",
      timestamp: Date.now(),
      webhookEventId: randomUUID(),
      replyToken: randomUUID(),
      mode: "active",
      source: { type: "group", groupId: group, userId: user },
      ...(data
        ? { postback: { data } }
        : { message: { type: "text", id: randomUUID(), text: "選單" } }),
    });
    async function send(e, signature) {
      const body = JSON.stringify({ events: [e] });
      const r = await fetch(base + "/webhook", {
        method: "POST",
        body,
        headers: {
          "x-line-signature":
            signature ||
            createHmac("sha256", "isolated-worker-secret")
              .update(body)
              .digest("base64"),
        },
      });
      return { status: r.status, ...(await r.json()) };
    }
    assert.equal((await send(event(alice), "tampered")).status, 401);
    const menu = await send(event(alice));
    assert.equal(menu.status, 200);
    assert.match(JSON.stringify(menu.messages), /個人數據/);
    const a = event(alice, "a=attend&id=smoke-match&status=yes"),
      b = event(bob, "a=attend&id=smoke-match&status=maybe");
    const results = await Promise.all([send(a), send(b)]);
    assert.ok(
      results.every((r) => r.status === 200 && r.messages.length === 1),
    );
    assert.equal((await send(a)).messages.length, 0);
    const rows = await (await fetch(base + "/state")).json();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.status),
      ["yes", "maybe"],
    );
    assert.ok(rows.every((r) => r.version === 1));
    const result = {
      ok: true,
      runtime: "workerd + native local Cloudflare D1",
      signedWebhook: true,
      invalidSignatureRejected: true,
      concurrentAttendance: 2,
      deduplicated: true,
      productionNetwork: false,
    };
    fs.writeFileSync(
      path.join(root, ".local/line-worker-smoke.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
