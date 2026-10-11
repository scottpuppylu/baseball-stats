import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { localDatabase } from "../src/local-db";
test("frontend credential dependency removed, credential files ignored and deployment fails closed", () => {
  const index = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    index,
    /GITHUB_TOKEN|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{30,}/,
  );
  assert.match(index, /\/api\/documents\//);
  assert.doesNotMatch(index, /Authorization:\s*['"`]token/);
  const config = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  assert.match(config,/"ENABLE_PUSH"\s*:\s*"false"/);
  assert.match(config,/"ALLOWED_GROUP_IDS"\s*:\s*""/);
  assert.match(config,/"ALLOW_PUBLIC_STATS"\s*:\s*"false"/);
  for (const file of [".env", "bot/.dev.vars", ".local/test.sqlite"])
    assert.equal(
      execFileSync("git", ["check-ignore", file], { encoding: "utf8" }).trim(),
      file,
    );
});
test("real SQLite persistence survives restart, schema is additive and failed batches roll back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "line-bot-persistence-")),
    filename = join(dir, "state.sqlite");
  let db = localDatabase(filename);
  try {
    await db
      .prepare("INSERT INTO bot_members VALUES(?,?,?,?,?,1)")
      .bind("test-group", "test-user", "test-player", "隔離球員", "player")
      .run();
    db.close();
    db = localDatabase(filename);
    assert.equal(
      (await db
        .prepare("SELECT name FROM bot_members")
        .first<{ name: string }>())!.name,
      "隔離球員",
    );
    await assert.rejects(
      db.batch([
        db.prepare("UPDATE bot_members SET name=?").bind("should-rollback"),
        db.prepare("INSERT INTO missing_table VALUES(?)").bind("invalid"),
      ]),
    );
    assert.equal(
      (await db
        .prepare("SELECT name FROM bot_members")
        .first<{ name: string }>())!.name,
      "隔離球員",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
