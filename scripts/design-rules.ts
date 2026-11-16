import {
  findPatterns,
  isTest,
  type PatternRule,
  type Source,
  withoutComments,
} from "./source-check.js";

export const designRules = [
  {
    name: "colour-literal",
    pattern:
      /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:rgba?|hsla?|oklch)\s*\(/gi,
    message: "Use a colour token.",
  },
  {
    name: "palette-class",
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/g,
    message: "Use a semantic colour token.",
  },
  {
    name: "arbitrary-value",
    pattern: /\b[\w-]+-\[(?!var\(--[\w-]+\)\])[^\]\n]+\](?!:)/g,
    message: "Use a theme utility instead of an arbitrary value.",
  },
  {
    name: "arbitrary-property",
    pattern: /(?:^|[\s"'`])\[[\w-]+:[^\]\n]+\]/g,
    message: "Use a theme utility instead of an arbitrary property.",
  },
  {
    name: "inline-style",
    pattern: /\bstyle\s*=/g,
    message: "Use token-based classes instead of inline styles.",
  },
  { name: "important", pattern: /!important\b/g, message: "Remove !important." },
  {
    name: "text-opacity",
    pattern: /\btext-[\w-]+\/(?:\d+(?:\.\d+)?|\[[^\]]+\])/g,
    message: "Use a text token instead of opacity.",
  },
] satisfies readonly PatternRule[];

export const technicalMessageKeys = new Set([
  "canonicalHashLabel",
  "declaredHashLabel",
  "txHashLabel",
  "merklePathLabel",
  "checkCanonicalEventHash",
  "checkHashChain",
  "checkMerkleInclusion",
  "checkAnchorReference",
]);

const interfaceWords: PatternRule = {
  name: "interface-word",
  pattern:
    /\b(?:hash(?:es)?|blocks?|merkle|on-chain|anchor(?:s|ed|ing)?|successfully|welcome back|oops)\b|!/gi,
  message: "Use plain interface language; technical terms belong in technical details.",
};

function checkMessages(source: Source) {
  const violations = [];
  for (const match of source.text.matchAll(
    /\b(\w+)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
  )) {
    const key = match[1];
    const value = match[2];
    if (!key || !value || technicalMessageKeys.has(key)) continue;
    const offset = match.index + match[0].indexOf(value);
    for (const violation of findPatterns({ ...source, text: value }, [interfaceWords])) {
      violations.push({
        ...violation,
        line: source.text.slice(0, offset).split("\n").length + violation.line - 1,
      });
    }
  }
  return violations;
}

export function checkDesign(source: Source) {
  if (isTest(source.file) || source.file === "apps/web/src/styles/tokens.css") return [];
  const cleaned = { ...source, text: withoutComments(source.text) };
  const violations = findPatterns(cleaned, designRules);
  return source.file.startsWith("apps/web/src/i18n/messages/")
    ? [...violations, ...checkMessages(cleaned)]
    : violations;
}
