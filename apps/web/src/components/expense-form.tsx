"use client";

import { formatInr, type Paise, toPaise } from "@yen/shared";
import { type FormEvent, useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";

const UPI_REGEX = /^[\w.-]+@[\w.-]+$/;

export interface ExpenseFormValues {
  amountRupees: string;
  payeeName: string;
  payeeUpi: string;
  purpose: string;
  receiptRef?: string | undefined;
}

export interface ValidatedExpenseSubmission {
  amountPaise: Paise;
  amountRupees: string;
  payeeName: string;
  payeeUpi: string;
  purpose: string;
  receiptRef?: string | undefined;
}

export interface ExpenseFormProps {
  fundId: string;
  spendableBalancePaise?: Paise | undefined;
  onSubmit: (data: ValidatedExpenseSubmission) => Promise<void> | void;
  onCancel?: (() => void) | undefined;
  initialValues?: Partial<ExpenseFormValues> | undefined;
  className?: string | undefined;
}

interface FormErrors {
  amountRupees?: string | undefined;
  payeeName?: string | undefined;
  payeeUpi?: string | undefined;
  purpose?: string | undefined;
}

export function ExpenseForm({
  fundId: _fundId,
  spendableBalancePaise,
  onSubmit,
  onCancel,
  initialValues,
  className,
}: ExpenseFormProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [values, setValues] = useState<ExpenseFormValues>({
    amountRupees: initialValues?.amountRupees ?? "",
    payeeName: initialValues?.payeeName ?? "",
    payeeUpi: initialValues?.payeeUpi ?? "",
    purpose: initialValues?.purpose ?? "",
    receiptRef: initialValues?.receiptRef ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validatedPaise, setValidatedPaise] = useState<Paise | null>(null);

  const validate = (): { isValid: boolean; paiseAmount: Paise | null; fieldErrors: FormErrors } => {
    const fieldErrors: FormErrors = {};
    let paiseAmount: Paise | null = null;

    const trimmedAmount = values.amountRupees.trim();
    if (!trimmedAmount) {
      fieldErrors.amountRupees = t("expenseForm.amountErrorRequired");
    } else {
      try {
        const parsed = toPaise(trimmedAmount);
        if (parsed <= 0) {
          fieldErrors.amountRupees = t("expenseForm.amountErrorPositive");
        } else if (spendableBalancePaise !== undefined && parsed > spendableBalancePaise) {
          fieldErrors.amountRupees = t("expenseForm.amountErrorExceeds", {
            max: formatInr(spendableBalancePaise),
          });
        } else {
          paiseAmount = parsed;
        }
      } catch {
        fieldErrors.amountRupees = t("expenseForm.amountErrorInvalid");
      }
    }

    const trimmedName = values.payeeName.trim();
    if (trimmedName.length < 2) {
      fieldErrors.payeeName = t("expenseForm.payeeNameError");
    }

    const trimmedUpi = values.payeeUpi.trim();
    if (!trimmedUpi || !UPI_REGEX.test(trimmedUpi)) {
      fieldErrors.payeeUpi = t("expenseForm.payeeUpiError");
    }

    const trimmedPurpose = values.purpose.trim();
    if (trimmedPurpose.length < 3) {
      fieldErrors.purpose = t("expenseForm.purposeError");
    }

    return {
      isValid: Object.keys(fieldErrors).length === 0 && paiseAmount !== null,
      paiseAmount,
      fieldErrors,
    };
  };

  const handleReview = (event: FormEvent) => {
    event.preventDefault();
    const result = validate();
    setErrors(result.fieldErrors);

    if (result.isValid && result.paiseAmount !== null) {
      setValidatedPaise(result.paiseAmount);
      setStep("review");
    }
  };

  const handleFinalSubmit = async () => {
    if (validatedPaise === null) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        amountPaise: validatedPaise,
        amountRupees: values.amountRupees.trim(),
        payeeName: values.payeeName.trim(),
        payeeUpi: values.payeeUpi.trim(),
        purpose: values.purpose.trim(),
        receiptRef: values.receiptRef?.trim() || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "review" && validatedPaise !== null) {
    return (
      <div
        className={cn(
          "flex flex-col gap-6 rounded-card border border-border bg-surface p-5 shadow-sm sm:p-6",
          className,
        )}
      >
        <div className="flex flex-col gap-1">
          <span className="text-small font-semibold uppercase tracking-wider text-primary">
            {t("expenseForm.reviewTitle")}
          </span>
          <h2 className="text-display font-bold text-ink">{formatInr(validatedPaise)}</h2>
          <p className="mt-1 text-body text-ink-muted">{t("expenseForm.reviewSummary")}</p>
        </div>

        <dl className="grid grid-cols-1 gap-4 rounded-control border border-border bg-canvas p-4 sm:grid-cols-2">
          <div>
            <dt className="text-small font-semibold text-ink-muted">{t("approver.payee")}</dt>
            <dd className="text-body font-semibold text-ink">{values.payeeName}</dd>
          </div>
          <div>
            <dt className="text-small font-semibold text-ink-muted">{t("approver.upiVpa")}</dt>
            <dd className="font-mono text-body font-medium text-ink">{values.payeeUpi}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-small font-semibold text-ink-muted">{t("approver.purpose")}</dt>
            <dd className="text-body text-ink">{values.purpose}</dd>
          </div>
          {values.receiptRef ? (
            <div className="sm:col-span-2">
              <dt className="text-small font-semibold text-ink-muted">
                {t("expenseForm.receiptLabel")}
              </dt>
              <dd className="text-body text-ink">{values.receiptRef}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse sm:items-center">
          <Button
            type="button"
            variant="primary"
            loading={isSubmitting}
            loadingLabel={t("expenseForm.submitting")}
            onClick={handleFinalSubmit}
            className="w-full sm:w-auto"
          >
            {t("expenseForm.submitCta")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => setStep("edit")}
            className="w-full sm:w-auto"
          >
            {t("expenseForm.editCta")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleReview}
      noValidate
      className={cn(
        "flex flex-col gap-5 rounded-card border border-border bg-surface p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div>
        <h2 className="text-title font-bold text-ink">{t("expenseForm.title")}</h2>
        <p className="mt-0.5 text-small text-ink-muted">{t("expenseForm.subtitle")}</p>
        {spendableBalancePaise !== undefined ? (
          <div className="mt-3 flex items-center justify-between rounded-control border border-border-strong/30 bg-canvas px-3 py-2 text-small">
            <span className="text-ink-muted">{t("treasurer.spendableBalance")}</span>
            <span className="font-semibold text-ink">{formatInr(spendableBalancePaise)}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Input
          id="expense-amount"
          label={t("expenseForm.amountLabel")}
          placeholder={t("expenseForm.amountPlaceholder")}
          hint={t("expenseForm.amountHint")}
          error={errors.amountRupees}
          value={values.amountRupees}
          inputMode="decimal"
          onChange={(e) => {
            const val = e.target.value;
            setValues((prev) => ({ ...prev, amountRupees: val }));
            if (errors.amountRupees) {
              setErrors((prev) => ({ ...prev, amountRupees: undefined }));
            }
          }}
          required
        />

        <Input
          id="expense-payee-name"
          label={t("expenseForm.payeeNameLabel")}
          placeholder={t("expenseForm.payeeNamePlaceholder")}
          hint={t("expenseForm.payeeNameHint")}
          error={errors.payeeName}
          value={values.payeeName}
          onChange={(e) => {
            const val = e.target.value;
            setValues((prev) => ({ ...prev, payeeName: val }));
            if (errors.payeeName) {
              setErrors((prev) => ({ ...prev, payeeName: undefined }));
            }
          }}
          required
        />

        <Input
          id="expense-payee-upi"
          label={t("expenseForm.payeeUpiLabel")}
          placeholder={t("expenseForm.payeeUpiPlaceholder")}
          hint={t("expenseForm.payeeUpiHint")}
          error={errors.payeeUpi}
          value={values.payeeUpi}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => {
            const val = e.target.value;
            setValues((prev) => ({ ...prev, payeeUpi: val }));
            if (errors.payeeUpi) {
              setErrors((prev) => ({ ...prev, payeeUpi: undefined }));
            }
          }}
          required
        />

        <Input
          id="expense-purpose"
          label={t("expenseForm.purposeLabel")}
          placeholder={t("expenseForm.purposePlaceholder")}
          hint={t("expenseForm.purposeHint")}
          error={errors.purpose}
          value={values.purpose}
          onChange={(e) => {
            const val = e.target.value;
            setValues((prev) => ({ ...prev, purpose: val }));
            if (errors.purpose) {
              setErrors((prev) => ({ ...prev, purpose: undefined }));
            }
          }}
          required
        />

        <Input
          id="expense-receipt-ref"
          label={t("expenseForm.receiptLabel")}
          placeholder={t("expenseForm.receiptPlaceholder")}
          hint={t("expenseForm.receiptHint")}
          value={values.receiptRef ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setValues((prev) => ({ ...prev, receiptRef: val }));
          }}
        />
      </div>

      <div className="flex flex-col gap-3 pt-3 sm:flex-row-reverse sm:items-center">
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          {t("expenseForm.reviewCta")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} className="w-full sm:w-auto">
            {t("approver.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
