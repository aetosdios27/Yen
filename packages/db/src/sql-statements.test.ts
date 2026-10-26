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
  ["CREATE TABLE escaped (é$$ int); COMMIT; SELECT $$ok$$;", ["CREATE", "COMMIT", "SELECT"]],
  ["CREATE TABLE escaped (𐀀$$ int); COMMIT; SELECT $$ok$$;", ["CREATE", "COMMIT", "SELECT"]],
  ["CREATE TABLE a$$b (id int); SELECT 1;", ["CREATE", "SELECT"]],
  ["DO $é$ BEGIN PERFORM 1; END $é$;", ["DO"]],
  ["DO $_x$ BEGIN PERFORM 1; END $_x$;", ["DO"]],
  ["DO $a1$ BEGIN PERFORM 1; END $a1$;", ["DO"]],
  ["PREPARE p(int) AS SELECT $1; EXECUTE p(1);", ["PREPARE", "EXECUTE"]],
])("splits top-level statements in %s", (source, keywords) => {
  expect(splitSqlStatements(source).map((statement) => statement.leadingKeywords[0])).toEqual(
    keywords,
  );
});

it("records the first token's line for each statement", () => {
  expect(splitSqlStatements("-- header\n SELECT 1; /* gap */\n  COMMIT; ")).toEqual([
    {
      line: 2,
      leadingKeywords: ["SELECT"],
      tokens: [
        { kind: "identifier", value: "SELECT", line: 2 },
        { kind: "other", line: 2 },
      ],
    },
    {
      line: 3,
      leadingKeywords: ["COMMIT"],
      tokens: [{ kind: "identifier", value: "COMMIT", line: 3 }],
    },
  ]);
});

it("counts bare carriage returns and CRLF as one line each", () => {
  expect(splitSqlStatements("-- note\rSELECT 1;\r\nCOMMIT;")).toEqual([
    {
      line: 2,
      leadingKeywords: ["SELECT"],
      tokens: [
        { kind: "identifier", value: "SELECT", line: 2 },
        { kind: "other", line: 2 },
      ],
    },
    {
      line: 3,
      leadingKeywords: ["COMMIT"],
      tokens: [{ kind: "identifier", value: "COMMIT", line: 3 }],
    },
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

it.each([
  "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42; END;",
  "CREATE PROCEDURE p() LANGUAGE SQL BEGIN ATOMIC END;",
  "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 AS case; END;",
  "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 case; END;",
  "CREATE FUNCTION f() RETURNS xml LANGUAGE SQL BEGIN ATOMIC SELECT XMLELEMENT(NAME case); END;",
  "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT x.case FROM (SELECT 42 AS case) x; END;",
  "CREATE OR REPLACE PROCEDURE p() LANGUAGE SQL BEGIN ATOMIC SELECT 1; SELECT 2; END;",
  `CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC
   SELECT CASE WHEN true THEN CASE WHEN true THEN 42 ELSE 0 END ELSE 0 END;
   SELECT "END", 'CASE; END', $$END;$$; END;`,
])("keeps atomic body fragments guarded in %s", (source) => {
  const statements = splitSqlStatements(`${source} COMMIT;`);
  expect(statements[0]?.leadingKeywords[0]).toBe("CREATE");
  expect(statements.at(-2)?.leadingKeywords).toEqual([]);
  expect(statements.at(-2)?.tokens).toEqual([
    { kind: "identifier", value: "END", line: expect.any(Number) },
  ]);
  expect(statements.at(-1)?.leadingKeywords[0]).toBe("COMMIT");
});

it.each(["COMMIT", "ROLLBACK", "END TRANSACTION", "BEGIN", "SAVEPOINT x"])(
  "preserves a transaction-control fragment %s inside an atomic body",
  (control) => {
    const statements = splitSqlStatements(
      `CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42; ${control}; END;`,
    );
    expect(statements[2]?.leadingKeywords[0]).toBe(control.split(" ")[0]);
    const firstBodyStatement = splitSqlStatements(
      `CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC ${control}; END;`,
    );
    expect(firstBodyStatement[1]?.leadingKeywords[0]).toBe(control.split(" ")[0]);
  },
);

it("keeps transaction control visible after a malformed CASE fragment", () => {
  const statements = splitSqlStatements(
    "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT CASE WHEN true THEN 1; END; COMMIT;",
  );
  expect(statements.at(-1)?.leadingKeywords[0]).toBe("COMMIT");
});

it.each([
  'CREATE FUNCTION f() RETURNS int LANGUAGE SQL "BEGIN" ATOMIC SELECT 42; END;',
  'CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN "ATOMIC" SELECT 42; END;',
  "CREATE FUNCTION f(begin atomic) RETURNS int LANGUAGE SQL AS 'SELECT 1'; END;",
])("does not mistake quoted body markers for keywords in %s", (source) => {
  expect(splitSqlStatements(source).at(-1)?.leadingKeywords[0]).toBe("END");
});

it.each([
  'CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT "CASE"; "END"; COMMIT;',
  "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1;",
])("fails closed on an ambiguous atomic body in %s", (source) => {
  expect(() => splitSqlStatements(source)).toThrow(/ambiguous atomic routine body/);
});
