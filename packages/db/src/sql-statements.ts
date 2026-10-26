export type SqlStatement = {
  line: number;
  leadingKeywords: string[];
};

export function splitSqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let index = 0;
  let line = 1;
  let statementLine = 0;
  let leadingKeywords: string[] = [];

  function advance(end: number): void {
    while (index < end) {
      if (source[index] === "\n") line++;
      index++;
    }
  }

  function start(): void {
    if (statementLine === 0) statementLine = line;
  }

  function finish(): void {
    if (statementLine !== 0) statements.push({ line: statementLine, leadingKeywords });
    statementLine = 0;
    leadingKeywords = [];
  }

  function singleQuote(escaped: boolean): void {
    const startLine = line;
    advance(index + 1);
    while (index < source.length) {
      if (escaped && source[index] === "\\") {
        advance(Math.min(index + 2, source.length));
      } else if (source[index] === "'") {
        if (source[index + 1] === "'") advance(index + 2);
        else {
          advance(index + 1);
          return;
        }
      } else {
        advance(index + 1);
      }
    }
    throw new Error(`line ${startLine}: unterminated single-quoted string`);
  }

  function doubleQuote(): void {
    const startLine = line;
    advance(index + 1);
    while (index < source.length) {
      if (source[index] === '"') {
        if (source[index + 1] === '"') advance(index + 2);
        else {
          advance(index + 1);
          return;
        }
      } else {
        advance(index + 1);
      }
    }
    throw new Error(`line ${startLine}: unterminated double-quoted identifier`);
  }

  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      advance(index + 1);
    } else if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      advance(end === -1 ? source.length : end);
    } else if (source.startsWith("/*", index)) {
      const startLine = line;
      let depth = 1;
      advance(index + 2);
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth++;
          advance(index + 2);
        } else if (source.startsWith("*/", index)) {
          depth--;
          advance(index + 2);
        } else {
          advance(index + 1);
        }
      }
      if (depth > 0) throw new Error(`line ${startLine}: unterminated block comment`);
    } else if (char === ";") {
      finish();
      advance(index + 1);
    } else if (char === "'") {
      start();
      singleQuote(false);
    } else if (char === '"') {
      start();
      doubleQuote();
    } else if (
      (char === "E" || char === "e") &&
      source[index + 1] === "'" &&
      (index === 0 || !/[a-zA-Z0-9_$]/.test(source[index - 1] ?? ""))
    ) {
      start();
      advance(index + 1);
      singleQuote(true);
    } else if (char === "$") {
      const opening =
        index === 0 || !/[a-zA-Z0-9_$]/.test(source[index - 1] ?? "")
          ? /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(source.slice(index))
          : null;
      if (opening) {
        start();
        const delimiter = opening[0];
        const startLine = line;
        advance(index + delimiter.length);
        const end = source.indexOf(delimiter, index);
        if (end === -1) throw new Error(`line ${startLine}: unterminated dollar-quoted string`);
        advance(end + delimiter.length);
      } else {
        start();
        advance(index + 1);
      }
    } else if (/[a-zA-Z_]/.test(char)) {
      start();
      const word = /^[a-zA-Z_][a-zA-Z0-9_$]*/.exec(source.slice(index));
      if (word) {
        if (leadingKeywords.length < 2) leadingKeywords.push(word[0].toUpperCase());
        advance(index + word[0].length);
      }
    } else {
      start();
      advance(index + 1);
    }
  }
  finish();
  return statements;
}
