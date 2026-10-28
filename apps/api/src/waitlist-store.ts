import { createWaitlistEntry, type Sql, type WaitlistEntry } from "@yen/db";
import type { WaitlistStore } from "./dependencies.js";

export class PostgresWaitlistStore implements WaitlistStore {
  constructor(private readonly sql: Sql) {}
  add(entry: WaitlistEntry) {
    return createWaitlistEntry(this.sql, entry);
  }
}
