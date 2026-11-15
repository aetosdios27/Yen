import type { ReactNode } from "react";
import { cn } from "./cn";

export type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 rounded-control border border-border bg-surface px-5 py-5 text-left",
        className,
      )}
    >
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <p className="max-w-prose text-small text-ink-muted">{description}</p>
      {action === undefined ? null : <div className="pt-1">{action}</div>}
    </div>
  );
}
