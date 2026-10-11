import type { Database, Flow } from "./types";
export class Store {
  constructor(readonly db: Database) {}
  statement(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args);
  }
  one<T>(sql: string, ...args: unknown[]) {
    return this.statement(sql, ...args).first<T>();
  }
  async all<T>(sql: string, ...args: unknown[]) {
    return (await this.statement(sql, ...args).all<T>()).results;
  }
  run(sql: string, ...args: unknown[]) {
    return this.statement(sql, ...args).run();
  }
  async claimEvent(id: string, group: string, now: number) {
    return (
      (
        await this.run(
          "INSERT OR IGNORE INTO bot_events VALUES(?,?,'processing',?)",
          id,
          group,
          now,
        )
      ).meta.changes > 0
    );
  }
  async flow(
    group: string,
    user: string,
    kind: string,
    step: string,
    payload: unknown,
    now: number,
  ) {
    const id = crypto.randomUUID();
    await this.run(
      "INSERT INTO bot_flows VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(group_id,user_id,kind) DO UPDATE SET id=excluded.id,step=excluded.step,payload=excluded.payload,version=1,expires=excluded.expires",
      id,
      group,
      user,
      kind,
      step,
      JSON.stringify(payload),
      now + 900000,
    );
    return (await this.one<Flow>("SELECT * FROM bot_flows WHERE id=?", id))!;
  }
  async updateFlow(flow: Flow, step: string, payload: unknown) {
    const r = await this.run(
      "UPDATE bot_flows SET step=?,payload=?,version=version+1 WHERE id=? AND version=?",
      step,
      JSON.stringify(payload),
      flow.id,
      flow.version,
    );
    if (!r.meta.changes) throw Error("操作已更新，請重新開啟選單。");
    return (await this.one<Flow>(
      "SELECT * FROM bot_flows WHERE id=?",
      flow.id,
    ))!;
  }
  async audit(
    group: string,
    user: string,
    event: string,
    action: string,
    target: string,
    now: number,
  ) {
    await this.run(
      "INSERT INTO bot_audit(event_id,user_id,group_id,action,target,at) VALUES(?,?,?,?,?,?)",
      event,
      user,
      group,
      action,
      target,
      now,
    );
  }
}
