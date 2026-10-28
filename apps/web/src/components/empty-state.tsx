import type { ReactNode } from "react";
import { cn } from "./cn";
import { InboxIcon } from "./icons";

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
        "flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-4 py-8 text-center",
        className,
      )}
    >
      <InboxIcon className="h-12 w-12 text-ink-muted" />
      <h3 className="text-title font-semibold text-ink">{title}</h3>
      <p className="max-w-prose text-small text-ink-muted">{description}</p>
      {action === undefined ? null : <div className="pt-1">{action}</div>}
    </div>
  );
}
