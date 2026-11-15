"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "../i18n";
import { LoaderIcon } from "./icons";
import { Button as PrimitiveButton } from "./ui/button";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  ghost: "ghost",
} as const;

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
    <PrimitiveButton
      {...props}
      type={type}
      variant={VARIANTS[variant]}
      className={className}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <LoaderIcon className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : null}
      <span>{children}</span>
      {loading ? <span className="sr-only">{loadingLabel ?? t("common.loading")}</span> : null}
    </PrimitiveButton>
  );
}
