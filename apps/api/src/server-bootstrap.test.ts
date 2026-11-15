import type { Sql } from "@yen/db";
import { describe, expect, it } from "vitest";
import { rawSqlDependency } from "./server-bootstrap.js";

const sql = {} as Sql;

describe("rawSqlDependency", () => {
  it("wires the database into the public routes only for an explicit development environment", () => {
    expect(rawSqlDependency(sql, "development")).toEqual({ sql });
  });

  it.each(["production", "test", "staging", undefined])(
    "leaves sql off for NODE_ENV=%s",
    (nodeEnv) => {
      expect(rawSqlDependency(sql, nodeEnv)).toEqual({});
    },
  );

  it("leaves sql off when there is no database", () => {
    expect(rawSqlDependency(undefined, "development")).toEqual({});
  });
});
