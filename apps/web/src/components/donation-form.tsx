"use client";

import { type FormEvent, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { paiseToRupeeString, parseRupeeString, upiIntent } from "../lib/upi";
import { Button } from "./button";
import { cn } from "./cn";
import { Input } from "./input";
import { QrCode } from "./qr-code";

/** ₹100, ₹500, ₹1,000 and ₹5,000 in paise. */
export const AMOUNT_CHIPS = [10_000, 50_000, 100_000, 500_000] as const;
const MAX_PLEDGE_PAISE = 100_000_000;
const UTR_PATTERN = /^[0-9]{12}$/;
const CONTACT_PATTERN = /^(?:\+[1-9][0-9]{7,14}|[6-9](?:[ -]?[0-9]){9}|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

export interface DonationPledge {
  amountPaise: number;
  utr: string;
  donorName?: string;
  donorContact?: string;
}

export type DonationOutcome = "pledged" | "duplicate_utr" | "failed";

export interface DonationFormProps {
  fundTitle: string;
  upiVpa: string;
  upiPayeeName: string;
  onSubmit: (pledge: DonationPledge) => Promise<DonationOutcome>;
}

interface FieldErrors {
  amount?: string;
  utr?: string;
  contact?: string;
  form?: string;
}

const errorProp = (error: string | undefined) => (error === undefined ? {} : { error });

/**
 * The donor pays the club's own UPI ID and then reports it. The pledge is only
 * a claim, so the last thing this screen says is that the bank decides.
 */
export function DonationForm({ fundTitle, upiVpa, upiPayeeName, onSubmit }: DonationFormProps) {
  const { t } = useI18n();
  const [chip, setChip] = useState<number>(AMOUNT_CHIPS[1]);
  const [custom, setCustom] = useState("");
  const [utr, setUtr] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "pledged">("idle");
  const amountRef = useRef<HTMLInputElement>(null);
  const utrRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLInputElement>(null);

  const customPaise = custom.trim() === "" ? null : parseRupeeString(custom);
  const amountPaise = custom.trim() === "" ? chip : customPaise;
  const intent = upiIntent({
    upiVpa,
    payeeName: upiPayeeName,
    note: fundTitle,
    ...(amountPaise === null ? {} : { amountPaise }),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const next: FieldErrors = {};
    if (custom.trim() !== "" && customPaise === null) next.amount = t("donate.amountInvalid");
    if (next.amount === undefined && amountPaise === null) next.amount = t("donate.amountRequired");
    if (next.amount === undefined && amountPaise !== null && amountPaise > MAX_PLEDGE_PAISE) {
      next.amount = t("donate.amountTooLarge");
    }
    if (!UTR_PATTERN.test(utr)) next.utr = t("donate.utrInvalid");
    if (contact.trim() !== "" && !CONTACT_PATTERN.test(contact.trim())) {
      next.contact = t("donate.contactInvalid");
    }

    setErrors(next);
    if (amountPaise === null || next.amount !== undefined) {
      amountRef.current?.focus();
      return;
    }
    if (next.utr !== undefined) {
      utrRef.current?.focus();
      return;
    }
    if (next.contact !== undefined) {
      contactRef.current?.focus();
      return;
    }

    setStatus("submitting");
    try {
      const outcome = await onSubmit({
        amountPaise,
        utr,
        ...(name.trim() === "" ? {} : { donorName: name.trim() }),
        ...(contact.trim() === "" ? {} : { donorContact: contact.trim() }),
      });
      if (outcome === "pledged") {
        setStatus("pledged");
        return;
      }
      setStatus("idle");
      setErrors(
        outcome === "duplicate_utr"
          ? { utr: t("donate.duplicateUtr") }
          : { form: t("donate.failure") },
      );
    } catch {
      setStatus("idle");
      setErrors({ form: t("donate.failure") });
    }
  }

  if (status === "pledged") {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
        <h1 className="text-heading font-bold tracking-tight text-ink">
          {t("donate.pendingTitle")}
        </h1>
        <p
          role="status"
          className="rounded-card border-2 border-verified-border bg-verified-bg p-4 text-body text-verified-ink"
        >
          {t("donate.pendingBody")}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <a
            href={`/receipts/${encodeURIComponent(utr)}`}
            className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
          >
            {t("donate.viewReceipt")}
          </a>
        </div>
      </section>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-bold tracking-tight text-ink">
          {t("donate.title", { fund: fundTitle })}
        </h1>
        <p className="text-body text-ink-muted">{t("donate.intro")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">{t("donate.amountTitle")}</h2>
        <fieldset>
          <legend className="sr-only">{t("donate.amountLegend")}</legend>
          <div className="flex flex-wrap gap-2">
            {AMOUNT_CHIPS.map((value) => {
              const pressed = custom.trim() === "" && chip === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    setChip(value);
                    setCustom("");
                  }}
                  className={cn(
                    "tap-target rounded-control border-2 px-4 py-3 text-body font-semibold tabular-nums",
                    pressed
                      ? "border-primary bg-primary text-on-solid"
                      : "border-border-strong bg-canvas text-ink hover:bg-primary-subtle",
                  )}
                >
                  {`₹${paiseToRupeeString(value).replace(/\.00$/, "")}`}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Input
          ref={amountRef}
          label={t("donate.customAmountLabel")}
          hint={t("donate.customAmountHint")}
          {...errorProp(errors.amount)}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">{t("donate.payTitle")}</h2>
        <p className="text-body text-ink-muted">{t("donate.payBody", { upiId: upiVpa })}</p>
        <div className="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4">
          <p className="text-small font-medium text-ink-muted">{t("donate.upiIdLabel")}</p>
          <code className="break-all text-body font-semibold text-ink">{upiVpa}</code>
          <a
            href={intent}
            className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
          >
            {t("donate.openUpiApp")}
          </a>
          <QrCode
            value={intent}
            label={t("donate.qrLabel", { upiId: upiVpa })}
            className="self-center"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">{t("donate.confirmTitle")}</h2>
        <p className="text-body text-ink-muted">{t("donate.confirmBody")}</p>
        <Input
          ref={utrRef}
          label={t("donate.utrLabel")}
          hint={t("donate.utrHint")}
          {...errorProp(errors.utr)}
          value={utr}
          onChange={(event) => setUtr(event.target.value.trim())}
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
        />
        <Input
          label={t("donate.nameLabel")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete="name"
        />
        <Input
          ref={contactRef}
          label={t("donate.contactLabel")}
          {...errorProp(errors.contact)}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          inputMode="email"
          autoComplete="email"
        />
        {errors.form === undefined ? null : (
          <p role="alert" className="text-small font-semibold text-danger">
            {errors.form}
          </p>
        )}
        <Button
          type="submit"
          loading={status === "submitting"}
          loadingLabel={t("donate.submitting")}
        >
          {t("donate.submit")}
        </Button>
        <p className="text-small text-ink-muted">{t("donate.pendingBody")}</p>
      </section>
    </form>
  );
}
