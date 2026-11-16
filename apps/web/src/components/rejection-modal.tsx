"use client";

import type { Paise } from "@yen/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { formatMoney } from "../lib/format";
import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

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
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError(undefined);
      setIsSubmitting(false);
    }
  }, [isOpen]);

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
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-modal="true"
        onOpenAutoFocus={() => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        showCloseButton={false}
        className={cn("max-w-md", className)}
      >
        <DialogTitle className="text-title font-bold text-ink">
          {t("approver.rejectModalTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-small text-ink-muted">
          {t("approver.rejectModalDescription")}
          {amountPaise !== undefined && payeeName !== undefined ? (
            <span className="mt-1 block font-medium text-ink">
              {formatMoney(amountPaise, { paise: "always" })} → {payeeName}
            </span>
          ) : null}
        </DialogDescription>

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
      </DialogContent>
    </Dialog>
  );
}
