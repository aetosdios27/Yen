"use client";
// Adapted from Rare UI (Swami Malode); license: docs/licenses/rare-ui.txt.
// Client-side toast events and animation require browser state.
import { Check, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { type ExternalToast, toast as sonner } from "sonner";
import { useI18n } from "../../i18n";
import { cn } from "../cn";

type ToastType = "default" | "success" | "error" | "warning" | "info" | "loading";
type ToastAction = { label: string; onClick: () => void };
type ToastOptions = Omit<ExternalToast, "description" | "action"> & {
  description?: ReactNode;
  action?: ToastAction;
};
const tones = {
  default: "bg-neutral text-ink-muted",
  success: "bg-signal text-on-signal",
  error: "bg-rejected-bg text-rejected-ink",
  warning: "bg-pending-bg text-pending-ink",
  info: "bg-neutral text-ink",
  loading: "bg-soft text-ink-muted",
};
const icons = {
  default: Info,
  success: Check,
  error: X,
  warning: TriangleAlert,
  info: Info,
  loading: LoaderCircle,
};

export function ToastCard({
  toastId,
  type,
  title,
  description,
  action,
  onDismiss,
  className,
  isOpen = true,
}: {
  toastId: string | number;
  type: ToastType;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  onDismiss?: () => void;
  className?: string;
  isOpen?: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const Icon = icons[type];
  return (
    <motion.div
      data-slot="toast"
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      className={cn(
        "flex items-center gap-3 rounded-card bg-surface p-4 shadow-raised",
        isOpen ? className : "sr-only",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("grid size-10 shrink-0 place-items-center rounded-control", tones[type])}
      >
        <Icon className="size-5" strokeWidth={1.5} />
      </span>
      <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">{isOpen ? title : null}</p>
        {isOpen && description && <p className="text-body text-ink-muted">{description}</p>}
      </div>
      {isOpen && action && (
        <button
          type="button"
          className="tap-target rounded-control bg-soft px-3"
          onClick={() => {
            action.onClick();
            sonner.dismiss(toastId);
          }}
        >
          {action.label}
        </button>
      )}
      {isOpen && (
        <button
          type="button"
          className="tap-target grid shrink-0 place-items-center rounded-control text-ink-muted"
          aria-label={t("common.dismiss")}
          onClick={() => (onDismiss ? onDismiss() : sonner.dismiss(toastId))}
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      )}
    </motion.div>
  );
}

function show(
  type: ToastType,
  title: ReactNode,
  { description, action, ...options }: ToastOptions = {},
) {
  return sonner.custom(
    (id) => (
      <ToastCard
        toastId={id}
        type={type}
        title={title}
        description={description}
        {...(action ? { action } : {})}
      />
    ),
    type === "loading" ? { ...options, duration: Infinity } : options,
  );
}
const variant = (type: ToastType) => (title: ReactNode, options?: ToastOptions) =>
  show(type, title, options);
export const toast = Object.assign(variant("default"), {
  success: variant("success"),
  error: variant("error"),
  warning: variant("warning"),
  info: variant("info"),
  dismiss: sonner.dismiss,
});
