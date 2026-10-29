"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toIntlLocale, useI18n } from "../i18n";
import { Button } from "./button";
import { Input } from "./input";
import { Toast } from "./toast";

type FieldName = "name" | "contact" | "org" | "consent";
type FieldErrors = Partial<Record<FieldName, string>>;

type Submission = {
  receivedAt: string;
  consentText: string;
};

const FIELD_ORDER: FieldName[] = ["name", "contact", "org", "consent"];

function isContact(value: string): boolean {
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  return /^\d{10}$/.test(trimmed.replace(/\D/g, ""));
}

export function WaitlistForm() {
  const { locale, t } = useI18n();
  const consentId = useId();
  const consentErrorId = `${consentId}-error`;
  const nameRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLInputElement>(null);
  const orgRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState({ name: "", contact: "", org: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [toastOpen, setToastOpen] = useState(true);

  useEffect(() => {
    if (submission !== null) confirmationRef.current?.focus();
  }, [submission]);

  function clearError(field: FieldName) {
    setSubmitError(null);
    setErrors((previous) => {
      if (previous[field] === undefined) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrors = {};
    if (values.name.trim() === "") next.name = t("waitlist.name.error");
    if (!isContact(values.contact)) next.contact = t("waitlist.contact.error");
    if (values.org.trim() === "") next.org = t("waitlist.org.error");
    if (!consent) next.consent = t("waitlist.consent.error");
    setErrors(next);
    setSubmitError(null);

    const refs = { name: nameRef, contact: contactRef, org: orgRef, consent: consentRef };
    const firstInvalid = FIELD_ORDER.find((field) => next[field] !== undefined);
    if (firstInvalid !== undefined) {
      refs[firstInvalid].current?.focus();
      return;
    }

    setSubmitting(true);
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "";
    try {
      const response = await fetch(`${apiOrigin}/v1/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          contact: values.contact.trim(),
          org: values.org.trim(),
          locale: locale === "hi" ? "hi" : "en",
          consent: {
            accepted: true,
            text: t("waitlist.consent.label"),
            version: "2026-10-27",
          },
        }),
      });

      if (!response.ok) {
        setSubmitError(t("waitlist.failed"));
        return;
      }

      setToastOpen(true);
      setSubmission({
        receivedAt: new Date().toISOString(),
        consentText: t("waitlist.consent.label"),
      });
    } catch {
      setSubmitError(t("waitlist.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (submission !== null) {
    return (
      <div className="flex flex-col gap-4">
        <div
          ref={confirmationRef}
          tabIndex={-1}
          role="status"
          className="rounded-card border-2 border-verified-border bg-verified-bg p-4 text-ink"
        >
          <p className="text-body font-semibold">{t("waitlist.success.title")}</p>
          <p className="mt-1 text-body">{t("waitlist.success.body")}</p>
          <p className="mt-2 text-small text-ink-muted">
            {t("waitlist.success.consent", {
              date: new Date(submission.receivedAt).toLocaleString(toIntlLocale(locale)),
              text: submission.consentText,
            })}
          </p>
        </div>
        <Toast
          open={toastOpen}
          tone="success"
          title={t("waitlist.success.title")}
          description={t("waitlist.success.body")}
          onClose={() => setToastOpen(false)}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={t("landing.waitlist.title")}
      className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-4"
    >
      <Input
        ref={nameRef}
        label={t("waitlist.name.label")}
        placeholder={t("waitlist.name.placeholder")}
        value={values.name}
        autoComplete="name"
        error={errors.name}
        onChange={(event) => {
          setValues((previous) => ({ ...previous, name: event.target.value }));
          clearError("name");
        }}
      />
      <Input
        ref={contactRef}
        label={t("waitlist.contact.label")}
        placeholder={t("waitlist.contact.placeholder")}
        hint={t("waitlist.contact.hint")}
        value={values.contact}
        autoComplete="tel"
        inputMode="email"
        error={errors.contact}
        onChange={(event) => {
          setValues((previous) => ({ ...previous, contact: event.target.value }));
          clearError("contact");
        }}
      />
      <Input
        ref={orgRef}
        label={t("waitlist.org.label")}
        placeholder={t("waitlist.org.placeholder")}
        value={values.org}
        autoComplete="organization"
        error={errors.org}
        onChange={(event) => {
          setValues((previous) => ({ ...previous, org: event.target.value }));
          clearError("org");
        }}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={consentId} className="tap-target flex items-start gap-3 py-1">
          <input
            ref={consentRef}
            id={consentId}
            type="checkbox"
            checked={consent}
            aria-invalid={errors.consent === undefined ? undefined : true}
            aria-describedby={errors.consent === undefined ? undefined : consentErrorId}
            onChange={(event) => {
              setConsent(event.target.checked);
              clearError("consent");
            }}
            className="mt-1 h-6 w-6 shrink-0 accent-primary"
          />
          <span className="text-small text-ink">{t("waitlist.consent.label")}</span>
        </label>
        <div
          id={consentErrorId}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="text-small font-semibold text-danger"
        >
          {errors.consent === undefined ? null : <p>{errors.consent}</p>}
        </div>
      </div>

      {submitError !== null ? (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="rounded-card border-2 border-danger bg-surface p-3 text-small font-semibold text-danger"
        >
          {submitError}
        </div>
      ) : null}

      <Button type="submit" loading={submitting}>
        {t("waitlist.submit")}
      </Button>
    </form>
  );
}
