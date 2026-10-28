"use client";

import { formatInr, type Paise } from "@yen/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";

export interface RejectionModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => Promise<void> | void;
  readonly amountPaise?: Paise | undefined;
  readonly payeeName?: string | undefined;
  readonly className?: string | undefined;
}

export function RejectionModal({
  isOpen,
  onClose,
  onConfirm,
  amountPaise,
  payeeName,
  className,
}: RejectionModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError(undefined);
      setIsSubmitting(false);
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
    const cleanReason = reason.trim();

    if (cleanReason.length < 5) {
      setError(t("approver.rejectReasonError"));
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(cleanReason);
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
        aria-labelledby="rejection-modal-title"
        aria-describedby="rejection-modal-description"
        className={cn(
          "relative z-10 w-full max-w-md rounded-card border-2 border-rejected-border bg-surface p-6 shadow-xl",
          className,
        )}
      >
        <h2 id="rejection-modal-title" className="text-title font-bold text-ink">
          {t("approver.rejectModalTitle")}
        </h2>
        <p id="rejection-modal-description" className="mt-1 text-small text-ink-muted">
          {t("approver.rejectModalDescription")}
          {amountPaise !== undefined && payeeName !== undefined ? (
            <span className="mt-1 block font-medium text-ink">
              {formatInr(amountPaise)} → {payeeName}
            </span>
          ) : null}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <Input
            ref={inputRef}
            id="rejection-reason-input"
            label={t("approver.rejectReasonLabel")}
            placeholder={t("approver.rejectReasonPlaceholder")}
            error={error}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(undefined);
            }}
            required
          />

          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
            <Button
              type="submit"
              variant="danger"
              loading={isSubmitting}
              loadingLabel={t("approver.rejectSubmitting")}
              className="w-full sm:w-auto"
            >
              {t("approver.rejectSubmit")}
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
