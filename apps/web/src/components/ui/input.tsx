import type * as React from "react";
import { cn } from "../cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "tap-target w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-faint disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
