export type SqlStatement = {
  line: number;
  leadingKeywords: string[];
  tokens: SqlToken[];
};

export type SqlToken =
  | { kind: "identifier"; value: string; line: number }
  | { kind: "openParen"; line: number }
  | { kind: "unicodeIdentifier"; line: number }
  | { kind: "unsafeString"; line: number };

function isIdentifierStart(codePoint: number): boolean {
  return (
    codePoint === 95 ||
    (codePoint >= 65 && codePoint <= 90) ||
    (codePoint >= 97 && codePoint <= 122) ||
    codePoint >= 128
  );
}

function isIdentifierContinuation(codePoint: number): boolean {
  return isIdentifierStart(codePoint) || (codePoint >= 48 && codePoint <= 57) || codePoint === 36;
}

export function splitSqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let index = 0;
  let line = 1;
  let statementLine = 0;
  let leadingKeywords: string[] = [];
  let tokens: SqlToken[] = [];

  function codePointAt(position: number): number | undefined {
    return source.codePointAt(position);
  }

  function nextCharacter(position: number): number {
    const codePoint = codePointAt(position);
    return position + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
  }

  function followsIdentifier(position: number): boolean {
    if (position === 0) return false;
    const previous = position - 1;
    const codeUnit = source.charCodeAt(previous);
    const start =
      codeUnit >= 0xdc00 &&
      codeUnit <= 0xdfff &&
      previous > 0 &&
      source.charCodeAt(previous - 1) >= 0xd800 &&
      source.charCodeAt(previous - 1) <= 0xdbff
        ? previous - 1
        : previous;
    const codePoint = codePointAt(start);
    return codePoint !== undefined && isIdentifierContinuation(codePoint);
  }

  function dollarDelimiter(position: number): string | undefined {
    if (followsIdentifier(position)) return undefined;
    let end = position + 1;
    const first = codePointAt(end);
    if (first !== undefined && isIdentifierStart(first)) {
      end = nextCharacter(end);
      while (end < source.length) {
        const codePoint = codePointAt(end);
        if (codePoint === undefined || codePoint === 36 || !isIdentifierContinuation(codePoint)) {
          break;
        }
        end = nextCharacter(end);
      }
    }
    return source[end] === "$" ? source.slice(position, end + 1) : undefined;
  }

  function advance(end: number): void {
    while (index < end) {
      if (source[index] === "\0") throw new Error(`line ${line}: NUL byte in SQL source`);
      if (source[index] === "\r" || (source[index] === "\n" && source[index - 1] !== "\r")) {
        line++;
      }
      index++;
    }
  }

  function start(): void {
    if (statementLine === 0) statementLine = line;
  }

  function finish(): void {
    if (statementLine !== 0) statements.push({ line: statementLine, leadingKeywords, tokens });
    statementLine = 0;
    leadingKeywords = [];
    tokens = [];
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
          if (!escaped && source[index - 1] === "\\") {
            tokens.push({ kind: "unsafeString", line: startLine });
          }
          advance(index + 1);
          return;
        }
      } else {
        advance(index + 1);
      }
    }
    throw new Error(`line ${startLine}: unterminated single-quoted string`);
  }

  function doubleQuote(): string {
    const startLine = line;
    const startIndex = index;
    advance(index + 1);
    while (index < source.length) {
      if (source[index] === '"') {
        if (source[index + 1] === '"') advance(index + 2);
        else {
          advance(index + 1);
          return source.slice(startIndex + 1, index - 1).replaceAll('""', '"');
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
    if (/[ \t\n\r\f]/.test(char)) {
      advance(index + 1);
    } else if (source.startsWith("--", index)) {
      let end = index + 2;
      while (end < source.length && source[end] !== "\r" && source[end] !== "\n") end++;
      advance(end);
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
      const tokenLine = line;
      tokens.push({ kind: "identifier", value: doubleQuote(), line: tokenLine });
    } else if (
      (char === "U" || char === "u") &&
      source[index + 1] === "&" &&
      source[index + 2] === '"' &&
      !followsIdentifier(index)
    ) {
      start();
      tokens.push({ kind: "unicodeIdentifier", line });
      advance(index + 2);
      doubleQuote();
    } else if (
      (char === "E" || char === "e") &&
      source[index + 1] === "'" &&
      !followsIdentifier(index)
    ) {
      start();
      advance(index + 1);
      singleQuote(true);
    } else if (char === "$") {
      const opening = dollarDelimiter(index);
      if (opening) {
        start();
        const startLine = line;
        advance(index + opening.length);
        const end = source.indexOf(opening, index);
        if (end === -1) throw new Error(`line ${startLine}: unterminated dollar-quoted string`);
        advance(end + opening.length);
      } else {
        start();
        advance(index + 1);
      }
    } else if (isIdentifierStart(codePointAt(index) ?? 0)) {
      start();
      const wordStart = index;
      const tokenLine = line;
      let wordEnd = nextCharacter(index);
      while (wordEnd < source.length) {
        const codePoint = codePointAt(wordEnd);
        if (codePoint === undefined || !isIdentifierContinuation(codePoint)) break;
        wordEnd = nextCharacter(wordEnd);
      }
      if (leadingKeywords.length < 2) {
        leadingKeywords.push(source.slice(wordStart, wordEnd).toUpperCase());
      }
      tokens.push({ kind: "identifier", value: source.slice(wordStart, wordEnd), line: tokenLine });
      advance(wordEnd);
    } else if (char === "(") {
      start();
      tokens.push({ kind: "openParen", line });
      advance(index + 1);
    } else {
      start();
      advance(index + 1);
    }
  }
  finish();
  return statements;
}
