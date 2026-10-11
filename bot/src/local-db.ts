// Local-only real SQLite adapter; production binds Cloudflare D1 to the same prepared SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Database, Statement } from "./types";
interface LocalStatement extends Statement {
  execute(): { meta: { changes: number } };
}
export function localDatabase(
  filename = ":memory:",
): Database & { close(): void } {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prepare = (sql: string): LocalStatement => {
    let values: unknown[] = [];
    const execute = () => ({
      meta: {
        changes: Number(
          sqlite.prepare(sql).run(...(values as never[])).changes,
        ),
      },
    });
    const statement: LocalStatement = {
      bind(...args) {
        values = args;
        return statement;
      },
      async first<T>() {
        return (sqlite.prepare(sql).get(...(values as never[])) as T) || null;
      },
      async all<T>() {
        return {
          results: sqlite.prepare(sql).all(...(values as never[])) as T[],
        };
      },
      async run() {
        return execute();
      },
      execute,
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => (s as LocalStatement).execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => sqlite.close(),
  };
}
