export const PRODUCT_LOCALES = ["en", "hi"] as const;
export const LOCALES = [...PRODUCT_LOCALES, "en-XA"] as const;

export type ProductLocale = (typeof PRODUCT_LOCALES)[number];
export type Locale = (typeof LOCALES)[number];

const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES);

export function isLocale(value: string): value is Locale {
  return LOCALE_SET.has(value);
}

/** Maps the test locale to a real locale for dates and numbers. */
export function toIntlLocale(locale: Locale): "en-IN" | "hi-IN" {
  return locale === "hi" ? "hi-IN" : "en-IN";
}
