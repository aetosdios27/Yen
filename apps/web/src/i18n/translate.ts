import { catalog } from "./catalog";
import type { Locale } from "./locales";
import type { MessageKey, Messages } from "./messages/en";

const PLACEHOLDER = /\{(\w+)\}/g;

/** Resolves a dot-separated key and fails loudly if the catalogue is broken. */
export function getMessage(messages: Messages, key: MessageKey): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      throw new Error(`Message "${key}" is not a leaf`);
    }
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) {
      throw new Error(`Missing message "${key}"`);
    }
  }
  if (typeof node !== "string") {
    throw new Error(`Message "${key}" is not a leaf`);
  }
  return node;
}

/** Replaces `{name}` placeholders without touching unknown ones. */
export function formatMessage(
  template: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  return formatMessage(getMessage(catalog[locale], key), values);
}
