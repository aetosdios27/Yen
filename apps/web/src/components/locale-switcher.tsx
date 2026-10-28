"use client";

import { useId } from "react";
import { isLocale, LOCALES, type Locale, type MessageKey, PRODUCT_LOCALES, useI18n } from "../i18n";
import { cn } from "./cn";

const LOCALE_LABEL_KEYS = {
  en: "locale.en",
  hi: "locale.hi",
  "en-XA": "locale.en-XA",
} as const satisfies Record<Locale, MessageKey>;

export type LocaleSwitcherProps = {
  className?: string;
  showPseudo?: boolean;
};

export function LocaleSwitcher({ className, showPseudo = false }: LocaleSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const selectId = useId();
  const locales = showPseudo ? LOCALES : PRODUCT_LOCALES;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <label htmlFor={selectId} className="text-small font-semibold text-ink">
        {t("locale.label")}
      </label>
      <select
        id={selectId}
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) {
            setLocale(next);
          }
        }}
        className="tap-target max-w-full rounded-control border-2 border-border-strong bg-canvas px-3 py-2 text-small font-medium text-ink"
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {t(LOCALE_LABEL_KEYS[option])}
          </option>
        ))}
      </select>
    </div>
  );
}
