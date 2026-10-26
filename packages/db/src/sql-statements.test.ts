import { expect, it } from "vitest";
import { splitSqlStatements } from "./sql-statements.js";

it.each([
  ["CREATE TABLE a (id int); COMMIT;", ["CREATE", "COMMIT"]],
  ["select 1;commit;", ["SELECT", "COMMIT"]],
  ["DO $$ BEGIN PERFORM 1; END $$;", ["DO"]],
  ["CREATE FUNCTION f() RETURNS void AS $f$ BEGIN COMMIT; END $f$ LANGUAGE plpgsql;", ["CREATE"]],
  ["SELECT '; COMMIT;';", ["SELECT"]],
  ["SELECT E'it\\'s; COMMIT;';", ["SELECT"]],
  ["-- COMMIT;\nSELECT 1;", ["SELECT"]],
  ["/* nested /* COMMIT; */ still comment */ SELECT 1;", ["SELECT"]],
  ['SELECT "commit";', ["SELECT"]],
  ['SELECT "co""mmit";', ["SELECT"]],
  ["SELECT commit_hash;", ["SELECT"]],
  ["SELECT $1;", ["SELECT"]],
  ["SELECT $1, $body$; COMMIT; $body$;", ["SELECT"]],
  ["DO $body$ BEGIN PERFORM '$$; COMMIT'; END $body$;", ["DO"]],
])("splits top-level statements in %s", (source, keywords) => {
  expect(splitSqlStatements(source).map((statement) => statement.leadingKeywords[0])).toEqual(
    keywords,
  );
});

it("records the first token's line for each statement", () => {
  expect(splitSqlStatements("-- header\n SELECT 1; /* gap */\n  COMMIT; ")).toEqual([
    { line: 2, leadingKeywords: ["SELECT"] },
    { line: 3, leadingKeywords: ["COMMIT"] },
  ]);
});

it.each([
  ["SELECT 'unfinished", "single-quoted string"],
  ["SELECT E'unfinished\\'", "single-quoted string"],
  ['SELECT "unfinished', "double-quoted identifier"],
  ["SELECT $body$ unfinished $$", "dollar-quoted string"],
  ["SELECT $$ unfinished $wrong$", "dollar-quoted string"],
  ["/* outer /* inner */", "block comment"],
])("rejects unterminated construct in %s", (source, construct) => {
  expect(() => splitSqlStatements(source)).toThrow(`line 1: unterminated ${construct}`);
});
