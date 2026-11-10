import { type Paise } from "@yen/shared";
import type { Locale } from "../i18n/locales";

const INTL_TAGS: Record<Locale, "en-IN" | "hi-IN"> = {
  en: "en-IN",
  hi: "hi-IN",
  "en-XA": "en-IN",
};

const integerFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function integerFormatter(tag: "en-IN" | "hi-IN"): Intl.NumberFormat {
  let formatter = integerFormatters.get(tag);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
    integerFormatters.set(tag, formatter);
  }
  return formatter;
}

function dateFormatter(tag: "en-IN" | "hi-IN"): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(tag);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    dateFormatters.set(tag, formatter);
  }
  return formatter;
}

function dateTimeFormatter(tag: "en-IN" | "hi-IN"): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(tag);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    dateTimeFormatters.set(tag, formatter);
  }
  return formatter;
}

/**
 * Formats paise as rupees with the lakh/crore digit grouping of the locale.
 * Rupees and paise are split before formatting, so no float is ever formatted.
 */
export function formatMoney(amount: Paise, locale: Locale): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const rupees = Math.trunc(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}₹${integerFormatter(INTL_TAGS[locale]).format(rupees)}.${remainder}`;
}

/** Day, abbreviated month and year in the locale. Falls back to the raw string. */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormatter(INTL_TAGS[locale]).format(date);
}

/** Day, abbreviated month, year, hour and minute in the locale. */
export function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateTimeFormatter(INTL_TAGS[locale]).format(date);
}
