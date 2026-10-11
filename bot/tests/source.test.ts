import { test } from "node:test";
import assert from "node:assert/strict";
import { source } from "../src/source";
import { snapshot } from "./helpers";
test("source is read-only, validates shapes, caches one snapshot and never fabricates failed formal data", async () => {
  const original = globalThis.fetch;
  let calls = 0,
    fail = false;
  const fixture = snapshot();
  globalThis.fetch = async (input, options) => {
    calls++;
    assert.equal(options?.method, undefined);
    assert.match(String(input), /^https:\/\/source\.test\//);
    if (fail) return new Response("{}", { status: 503 });
    const n = String(input).split("/").at(-1)!.replace(".json", "");
    return n === "guests"
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify(fixture[n as keyof typeof fixture]));
  };
  try {
    const load = source("https://source.test");
    const first = await load();
    assert.equal(first.source, "https://source.test");
    assert.ok(first.digest);
    assert.deepEqual(first.guests, []);
    assert.strictEqual(await load(), first);
    assert.equal(calls, 5);
    fail = true;
    await assert.rejects(source("https://source.test")(), /正式資料來源/);
    assert.throws(() => source("http://bad.test"), /HTTPS/);
  } finally {
    globalThis.fetch = original;
  }
});
