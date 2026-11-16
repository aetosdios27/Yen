import type { Paise } from "@yen/shared";
import { z } from "zod";
import { type Locale, toIntlLocale } from "../i18n/locales";

export type MoneyInput = Paise | bigint | string;
export type MoneyOptions = { locale?: Locale; paise?: "auto" | "always" };
export type DateOptions = { locale?: Locale; timeZone?: string };

const integerPaise = z.union([z.number().int().safe(), z.bigint(), z.string().regex(/^-?\d+$/)]);

function readPaise(amount: MoneyInput): bigint {
  return BigInt(integerPaise.parse(amount));
}

function moneyOptions(options: MoneyOptions | Locale): MoneyOptions {
  // Existing locale-only callers retain their two decimal places.
  return typeof options === "string" ? { locale: options, paise: "always" } : options;
}

export function formatMoney(amount: MoneyInput, options: MoneyOptions | Locale = {}): string {
  const settings = moneyOptions(options);
  const value = readPaise(amount);
  const absolute = value < 0n ? -value : value;
  const whole = new Intl.NumberFormat(toIntlLocale(settings.locale ?? "en")).format(
    absolute / 100n,
  );
  const remainder = absolute % 100n;
  const fraction =
    settings.paise === "always" || remainder !== 0n ? `.${String(remainder).padStart(2, "0")}` : "";
  return `${value < 0n ? "-" : ""}₹${whole}${fraction}`;
}

export function formatSignedMoney(amount: MoneyInput, options: MoneyOptions = {}): string {
  const value = readPaise(amount);
  return `${value < 0n ? "−" : "+"} ${formatMoney(value < 0n ? -value : value, options)}`;
}

function dateOptions(options: DateOptions | Locale): DateOptions {
  return typeof options === "string" ? { locale: options } : options;
}

export function formatDate(iso: string, options: DateOptions | Locale = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const settings = dateOptions(options);
  return new Intl.DateTimeFormat(toIntlLocale(settings.locale ?? "en"), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: settings.timeZone,
  }).format(date);
}

export function formatTime(iso: string, options: DateOptions | Locale = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const settings = dateOptions(options);
  return new Intl.DateTimeFormat(toIntlLocale(settings.locale ?? "en"), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: settings.timeZone,
  }).format(date);
}

// Receipts and verify retain the existing padded hour and combined punctuation.
export function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
