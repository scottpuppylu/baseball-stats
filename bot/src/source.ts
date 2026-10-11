import { createHash } from "node:crypto";
import { createEngine } from "../generated/engine.mjs";
import type { Snapshot } from "./types";
export const playerKey = (name: string) =>
  createHash("sha256").update(name).digest("hex").slice(0, 20);
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function source(
  base = "https://raw.githubusercontent.com/scottpuppylu/baseball-stats/data/data",
) {
  if (!base.startsWith("https://")) throw Error("正式資料來源必須是 HTTPS");
  let cached: Snapshot | undefined;
  return async (): Promise<Snapshot> => {
    if (cached && Date.now() - cached.fetchedAt < 30000) return cached;
    const paths = ["logs", "games", "defense", "avatars", "guests"] as const;
    const values = await Promise.all(
      paths.map(async (name) => {
        const r = await fetch(`${base}/${name}.json`, {
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 404 && name === "guests") return [];
        if (!r.ok)
          throw Error(`正式資料來源 ${name} 暫時無法讀取，請稍後重試。`);
        const raw = await r.text();
        if (raw.length > 8_000_000) throw Error("來源資料過大");
        const b = JSON.parse(raw);
        if (
          ["logs", "games", "guests"].includes(name)
            ? !Array.isArray(b)
            : !b || Array.isArray(b) || typeof b !== "object"
        )
          throw Error("來源資料格式錯誤");
        return b;
      }),
    );
    cached = {
      ...Object.fromEntries(paths.map((name, i) => [name, values[i]])),
      digest: digest(values),
      fetchedAt: Date.now(),
      source: base,
    } as Snapshot;
    return cached;
  };
}
export const engine = createEngine;
