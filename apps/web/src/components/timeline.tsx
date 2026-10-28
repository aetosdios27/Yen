import { cn } from "./cn";

export type TimelineTone = "positive" | "neutral" | "warning";

export type TimelineItem = {
  id: string;
  title: string;
  description?: string;
  dateTime: string;
  timestamp: string;
  tone?: TimelineTone;
};

const TONE_DOTS: Record<TimelineTone, string> = {
  positive: "bg-verified-ink",
  neutral: "bg-border-strong",
  warning: "bg-unmatched-ink",
};

export type TimelineProps = {
  items: readonly TimelineItem[];
  label: string;
};

/** Record history uses `<ol>` so assistive tech announces the order. */
export function Timeline({ items, label }: TimelineProps) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={item.id} className="flex gap-3">
            <div aria-hidden="true" className="flex w-3 shrink-0 flex-col items-center">
              <span
                className={cn(
                  "mt-2 h-3 w-3 shrink-0 rounded-full",
                  TONE_DOTS[item.tone ?? "neutral"],
                )}
              />
              {isLast ? null : <span className="mt-1 w-0.5 flex-1 bg-border" />}
            </div>
            <div className={cn("min-w-0 flex-1 break-words", isLast ? "pb-0" : "pb-6")}>
              <p className="text-body font-semibold text-ink">{item.title}</p>
              {item.description === undefined ? null : (
                <p className="mt-0.5 text-small text-ink-muted">{item.description}</p>
              )}
              <time dateTime={item.dateTime} className="mt-1 block text-small text-ink-muted">
                {item.timestamp}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
