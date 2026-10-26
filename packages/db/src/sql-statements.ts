export type SqlStatement = {
  line: number;
  leadingKeywords: string[];
  tokens: SqlToken[];
};

export type SqlToken =
  | { kind: "identifier"; value: string; line: number }
  | { kind: "stringLiteral"; value: string; line: number }
  | { kind: "openParen"; line: number }
  | { kind: "comma"; line: number }
  | { kind: "dot"; line: number }
  | { kind: "other"; line: number }
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
  let quotedIdentifiers = new Set<number>();
  let atomicBody = false;
  let atomicClosingEnd = false;
  let parenDepth = 0;

  function unquotedWord(position: number, word: string): boolean {
    const token = tokens[position];
    return (
      token?.kind === "identifier" &&
      !quotedIdentifiers.has(position) &&
      token.value.toUpperCase() === word
    );
  }

  function routineHeader(): boolean {
    return (
      unquotedWord(0, "CREATE") &&
      (unquotedWord(1, "FUNCTION") ||
        unquotedWord(1, "PROCEDURE") ||
        (unquotedWord(1, "OR") &&
          unquotedWord(2, "REPLACE") &&
          (unquotedWord(3, "FUNCTION") || unquotedWord(3, "PROCEDURE"))))
    );
  }

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
    if (atomicClosingEnd && tokens.length === 1 && unquotedWord(0, "END")) {
      // Keep the token available to the other preflight checks.
      leadingKeywords = [];
      atomicBody = false;
    }
    if (statementLine !== 0) statements.push({ line: statementLine, leadingKeywords, tokens });
    statementLine = 0;
    leadingKeywords = [];
    tokens = [];
    quotedIdentifiers = new Set<number>();
    atomicClosingEnd = false;
    parenDepth = 0;
  }

  function singleQuote(escaped: boolean): void {
    const startLine = line;
    let value = "";
    advance(index + 1);
    while (index < source.length) {
      if (escaped && source[index] === "\\") {
        const next = source[index + 1];
        if (next === undefined)
          throw new Error(`line ${startLine}: unterminated single-quoted string`);
        let escapeEnd = index + 2;
        if (/[0-7]/.test(next)) {
          while (escapeEnd < index + 4 && /[0-7]/.test(source[escapeEnd] ?? "")) escapeEnd++;
          value += String.fromCharCode(
            Number.parseInt(source.slice(index + 1, escapeEnd), 8) % 256,
          );
        } else if (next === "x" || next === "X") {
          while (escapeEnd < index + 4 && /[0-9a-fA-F]/.test(source[escapeEnd] ?? "")) {
            escapeEnd++;
          }
          value +=
            escapeEnd === index + 2
              ? next
              : String.fromCharCode(Number.parseInt(source.slice(index + 2, escapeEnd), 16));
        } else if (next === "u" || next === "U") {
          const digits = next === "u" ? 4 : 8;
          const encoded = source.slice(index + 2, index + 2 + digits);
          if (encoded.length === digits && /^[0-9a-fA-F]+$/.test(encoded)) {
            const codePoint = Number.parseInt(encoded, 16);
            value += codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : next;
            escapeEnd += digits;
          } else {
            value += next;
          }
        } else {
          value +=
            next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "n"
                  ? "\n"
                  : next === "r"
                    ? "\r"
                    : next === "t"
                      ? "\t"
                      : next;
        }
        advance(escapeEnd);
      } else if (source[index] === "'") {
        if (source[index + 1] === "'") {
          value += "'";
          advance(index + 2);
        } else {
          if (!escaped && source[index - 1] === "\\") {
            tokens.push({ kind: "unsafeString", line: startLine });
          }
          tokens.push({ kind: "stringLiteral", value, line: startLine });
          advance(index + 1);
          return;
        }
      } else {
        value += source[index];
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
      quotedIdentifiers.add(tokens.length);
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
        tokens.push({ kind: "other", line: startLine });
        advance(index + opening.length);
        const end = source.indexOf(opening, index);
        if (end === -1) throw new Error(`line ${startLine}: unterminated dollar-quoted string`);
        advance(end + opening.length);
      } else {
        start();
        tokens.push({ kind: "other", line });
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
      const value = source.slice(wordStart, wordEnd);
      const word = value.toUpperCase();
      let startsAtomicBody = false;
      if (
        !atomicBody &&
        parenDepth === 0 &&
        word === "ATOMIC" &&
        unquotedWord(tokens.length - 1, "BEGIN") &&
        routineHeader()
      ) {
        atomicBody = true;
        startsAtomicBody = true;
      } else if (atomicBody && word === "END" && tokens.length === 0) {
        atomicClosingEnd = true;
      }
      if (leadingKeywords.length < 2) leadingKeywords.push(word);
      tokens.push({ kind: "identifier", value, line: tokenLine });
      advance(wordEnd);
      if (startsAtomicBody) finish();
    } else if (char === "(") {
      start();
      tokens.push({ kind: "openParen", line });
      parenDepth++;
      advance(index + 1);
    } else if (char === ".") {
      start();
      tokens.push({ kind: "dot", line });
      advance(index + 1);
    } else if (char === ",") {
      start();
      tokens.push({ kind: "comma", line });
      advance(index + 1);
    } else {
      start();
      tokens.push({ kind: "other", line });
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
      advance(index + 1);
    }
  }
  finish();
  if (atomicBody) throw new Error(`line ${line}: unterminated or ambiguous atomic routine body`);
  return statements;
}
