import type { Paise } from "@yen/shared";
import { useI18n } from "../i18n";
import { formatMoney } from "../lib/format";
import { cn } from "./cn";

export type MoneyProps = {
  amount: Paise;
  label?: string;
  className?: string;
};

/**
 * Renders integer paise in the active locale, never through floating-point
 * arithmetic, so large and fractional rupee values stay exact.
 */
export function Money({ amount, label, className }: MoneyProps) {
  const { locale } = useI18n();

  return (
    <p className={cn("flex flex-col gap-0.5", className)}>
      {label === undefined ? null : (
        <span className="text-small font-medium text-ink-muted">{label}</span>
      )}
      <data value={String(amount)} className="block text-title font-semibold tabular-nums text-ink">
        {formatMoney(amount, locale)}
      </data>
    </p>
  );
}
