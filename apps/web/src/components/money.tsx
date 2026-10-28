import { formatInr, type Paise } from "@yen/shared";
import { cn } from "./cn";

export type MoneyProps = {
  amount: Paise;
  label?: string;
  className?: string;
};

/**
 * Renders integer paise through `formatInr`, never through floating-point
 * arithmetic, so large and fractional rupee values stay exact.
 */
export function Money({ amount, label, className }: MoneyProps) {
  return (
    <p className={cn("flex flex-col gap-0.5", className)}>
      {label === undefined ? null : (
        <span className="text-small font-medium text-ink-muted">{label}</span>
      )}
      <data value={String(amount)} className="block text-title font-semibold tabular-nums text-ink">
        {formatInr(amount)}
      </data>
    </p>
  );
}
