"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "../i18n";
import { cn } from "./cn";
import { LoaderIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: "border-primary bg-primary text-on-solid hover:bg-primary-hover",
  secondary: "border-primary bg-canvas text-primary hover:bg-primary-subtle",
  danger: "border-danger bg-danger text-on-solid hover:bg-danger-hover",
  ghost: "border-transparent bg-transparent text-primary hover:bg-primary-subtle",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  type?: "button" | "submit" | "reset";
  children: ReactNode;
};

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel,
  type = "button",
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const { t } = useI18n();

  return (
    <button
      {...props}
      type={type}
      className={cn(
        "tap-target inline-flex items-center justify-center gap-2 rounded-control border-2 px-5 py-3 text-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_STYLES[variant],
        className,
      )}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <LoaderIcon className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : null}
      <span>{children}</span>
      {loading ? <span className="sr-only">{loadingLabel ?? t("common.loading")}</span> : null}
    </button>
  );
}
