"use client";

import { type ComponentPropsWithRef, useId } from "react";
import { cn } from "./cn";

export type InputProps = Omit<ComponentPropsWithRef<"input">, "id"> & {
  id?: string | undefined;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
};

export function Input({ id, label, hint, error, className, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-small font-semibold text-ink">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={cn(
          "tap-target w-full rounded-control border-2 bg-canvas px-4 py-3 text-body text-ink placeholder:text-ink-muted",
          error === undefined ? "border-border-strong" : "border-danger",
          className,
        )}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-small text-ink-muted">
          {hint}
        </p>
      )}
      {/* The live region is always mounted so a late error is announced. */}
      <div
        id={errorId}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="text-small font-semibold text-danger"
      >
        {error === undefined ? null : <p>{error}</p>}
      </div>
    </div>
  );
}
