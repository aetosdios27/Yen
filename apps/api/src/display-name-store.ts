import { getDisplayName, getOfficeholderNamesShown, type Sql } from "@yen/db";
import type { DisplayNameStore } from "./dependencies.js";

export class PostgresDisplayNameStore implements DisplayNameStore {
  constructor(private readonly sql: Sql) {}

  get(fundId: string, pseudonymId: string) {
    return getDisplayName(this.sql, { fundId, pseudonymId });
  }

  officeholderNamesShown(fundId: string) {
    return getOfficeholderNamesShown(this.sql, fundId);
  }
}
