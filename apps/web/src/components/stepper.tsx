"use client";

import { useI18n } from "../i18n";
import { cn } from "./cn";
import { CheckIcon } from "./icons";

export type StepperStep = {
  id: string;
  label: string;
};

export type StepperProps = {
  steps: readonly StepperStep[];
  current: number;
  label: string;
};

export function Stepper({ steps, current, label }: StepperProps) {
  const { t } = useI18n();

  return (
    <nav aria-label={label}>
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => {
          const number = index + 1;
          const isCurrent = number === current;
          const isComplete = number < current;
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-center gap-3"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-small font-bold",
                  isCurrent
                    ? "border-primary bg-primary text-on-solid"
                    : isComplete
                      ? "border-primary bg-primary-subtle text-primary"
                      : "border-border-strong bg-canvas text-ink-muted",
                )}
              >
                {isComplete ? <CheckIcon className="h-5 w-5" /> : number}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "text-body",
                  isCurrent ? "font-bold text-ink" : "font-medium text-ink-muted",
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {t("stepper.step", {
                  current: number,
                  total: steps.length,
                  label: step.label,
                })}
                {isComplete ? ` ${t("stepper.completed")}` : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
