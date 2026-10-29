"use client";

import { formatInr, type Paise } from "@yen/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";

export interface ApprovalPinModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (pin: string) => Promise<void> | void;
  readonly amountPaise?: Paise | undefined;
  readonly payeeName?: string | undefined;
  readonly className?: string | undefined;
}

export function ApprovalPinModal({
  isOpen,
  onClose,
  onConfirm,
  amountPaise,
  payeeName,
  className,
}: ApprovalPinModalProps) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin("");
      setError(undefined);
      setIsSubmitting(false);
      // Autofocus input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanPin = pin.trim();

    if (!/^\d{6}$/.test(cleanPin)) {
      setError(t("approver.pinError"));
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(cleanPin);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="fixed inset-0 bg-black/60 backdrop-blur-xs" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
        aria-describedby="pin-modal-description"
        className={cn(
          "relative z-10 w-full max-w-md rounded-card border-2 border-verified-border bg-surface p-6 shadow-xl",
          className,
        )}
      >
        <h2 id="pin-modal-title" className="text-title font-bold text-ink">
          {t("approver.pinModalTitle")}
        </h2>
        <p id="pin-modal-description" className="mt-1 text-small text-ink-muted">
          {t("approver.pinModalDescription")}
          {amountPaise !== undefined && payeeName !== undefined ? (
            <span className="mt-1 block font-medium text-ink">
              {formatInr(amountPaise)} → {payeeName}
            </span>
          ) : null}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <Input
            ref={inputRef}
            id="approval-pin-input"
            label={t("approver.pinLabel")}
            hint={t("approver.pinHint")}
            error={error}
            value={pin}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            className="text-center font-mono text-2xl tracking-[0.5em]"
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 6);
              setPin(val);
              if (error) setError(undefined);
            }}
            required
          />

          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              loadingLabel={t("approver.pinSubmitting")}
              className="w-full sm:w-auto"
            >
              {t("approver.pinSubmit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={onClose}
              className="w-full sm:w-auto"
            >
              {t("approver.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
