"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import {
  EMPTY_ONBOARDING_DRAFT,
  isApproverContact,
  isCanonicalPaise,
  isUpiVpa,
  type OnboardingDraft,
  type VisibilityPreset,
  whatsappInviteLink,
} from "../lib/onboarding";

const DRAFT_KEY = "yen:onboarding:draft:v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const stepNames = ["Club", "Fund", "Payment", "Approvers", "Visibility"];

function updateDraft<K extends keyof OnboardingDraft>(
  draft: OnboardingDraft,
  key: K,
  value: OnboardingDraft[K],
): OnboardingDraft {
  return { ...draft, [key]: value };
}

function stepError(step: number, draft: OnboardingDraft): string | null {
  if (step === 0 && (!draft.clubName.trim() || !draft.clubType))
    return "Enter the club name and type.";
  if (step === 1 && (!draft.purpose.trim() || !isCanonicalPaise(draft.targetPaise)))
    return "Enter a purpose and target in whole paise.";
  if (step === 2 && (!isUpiVpa(draft.upiVpa) || !draft.payeeName.trim()))
    return "Enter a valid UPI VPA and account name.";
  if (
    step === 3 &&
    draft.approvers.filter((person) => person.name.trim() && isApproverContact(person.contact))
      .length < 2
  )
    return "Nominate at least two approvers with valid phone numbers for WhatsApp/SMS invites.";
  return null;
}

export function OnboardingWizard() {
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_ONBOARDING_DRAFT);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{ fundId: string; inviteLinks: string[] } | null>(
    null,
  );
  const descriptionId = useId();

  useEffect(() => {
    const stored = window.localStorage.getItem(DRAFT_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<OnboardingDraft> & { step?: number };
      setDraft({
        ...EMPTY_ONBOARDING_DRAFT,
        ...parsed,
        approvers: parsed.approvers ?? EMPTY_ONBOARDING_DRAFT.approvers,
      });
      setStep(Math.max(0, Math.min(4, parsed.step ?? 0)));
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, step }));
  }, [draft, step]);

  const next = () => {
    const message = stepError(step, draft);
    if (message) return setError(message);
    setError(null);
    setStep((current) => Math.min(4, current + 1));
  };

  const complete = async () => {
    const message = stepError(4, draft) ?? stepError(3, draft);
    if (message) return setError(message);
    setSubmitting(true);
    setError(null);
    try {
      const result = await fetch(`${API_URL}/v1/funds`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          name: draft.clubName.trim(),
          purpose: [draft.purpose.trim(), draft.description.trim()].filter(Boolean).join(" — "),
          targetPaise: draft.targetPaise,
          upiVpa: draft.upiVpa.trim(),
          upiPayeeName: draft.payeeName.trim(),
          visibility: draft.visibility,
        }),
      });
      if (!result.ok) throw new Error("The fund could not be created. Please retry.");
      const fund = (await result.json()) as { id: string };
      const links: string[] = [];
      for (const person of draft.approvers.filter(
        (candidate) => candidate.name.trim() && candidate.contact.trim(),
      )) {
        const phone = person.contact.trim();
        if (!isApproverContact(phone)) {
          throw new Error(
            `Invalid phone number for approver ${person.name.trim()}: "${phone}". Enter an international phone number (e.g. +919876543210).`,
          );
        }
        const invite = await fetch(`${API_URL}/v1/funds/${encodeURIComponent(fund.id)}/invites`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        if (!invite.ok) {
          throw new Error(
            `Failed to create invite for ${person.name.trim()} (${phone}). Please verify the phone number and retry.`,
          );
        }
        const data = (await invite.json()) as { code: string };
        const path = `${window.location.origin}/invites/accept?code=${encodeURIComponent(data.code)}`;
        links.push(whatsappInviteLink(path, draft.clubName.trim()));
      }
      window.localStorage.removeItem(DRAFT_KEY);
      setCompleted({ fundId: fund.id, inviteLinks: links });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The fund could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  if (completed)
    return <Completion fundId={completed.fundId} inviteLinks={completed.inviteLinks} />;

  return (
    <form
      className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6"
      onSubmit={(event) => {
        event.preventDefault();
        step === 4 ? void complete() : next();
      }}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-bold text-ink">Set up your club fund</h1>
        <p id={descriptionId} className="text-body text-ink-muted">
          Your progress is saved on this device. Target amounts are entered as whole paise.
        </p>
      </header>
      <ol aria-label="Onboarding progress" className="flex gap-1" aria-describedby={descriptionId}>
        {stepNames.map((name, index) => (
          <li
            key={name}
            className={`h-2 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`}
          >
            <span className="sr-only">
              {name}
              {index === step ? ", current step" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-small font-semibold text-ink">
        Step {step + 1} of 5: {stepNames[step]}
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-danger bg-danger-subtle p-3 text-body text-ink"
        >
          {error}
        </p>
      ) : null}
      {step === 0 ? <ClubStep draft={draft} setDraft={setDraft} /> : null}
      {step === 1 ? <FundStep draft={draft} setDraft={setDraft} /> : null}
      {step === 2 ? <PaymentStep draft={draft} setDraft={setDraft} /> : null}
      {step === 3 ? <ApproverStep draft={draft} setDraft={setDraft} /> : null}
      {step === 4 ? <VisibilityStep draft={draft} setDraft={setDraft} /> : null}
      <footer className="flex justify-between gap-3">
        <button
          type="button"
          className="tap-target rounded-control border-2 border-border px-4 font-semibold disabled:opacity-50"
          disabled={step === 0 || submitting}
          onClick={() => {
            setError(null);
            setStep((current) => current - 1);
          }}
        >
          Back
        </button>
        <button
          type="submit"
          className="tap-target rounded-control bg-primary px-5 font-semibold text-on-solid disabled:opacity-50"
          disabled={submitting}
        >
          {step === 4 ? (submitting ? "Creating…" : "Create fund") : "Continue"}
        </button>
      </footer>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-body font-semibold text-ink">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "tap-target rounded-control border-2 border-border bg-surface px-3 text-body text-ink";

function ClubStep({ draft, setDraft }: StepProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-heading font-bold">Club details</legend>
      <Field label="Club or organisation name" id="onboarding-club-name">
        <input
          id="onboarding-club-name"
          className={inputClass}
          value={draft.clubName}
          onChange={(e) => setDraft(updateDraft(draft, "clubName", e.target.value))}
        />
      </Field>
      <Field label="Club type" id="onboarding-club-type">
        <select
          id="onboarding-club-type"
          className={inputClass}
          value={draft.clubType}
          onChange={(e) => setDraft(updateDraft(draft, "clubType", e.target.value))}
        >
          <option value="residents">Residents association</option>
          <option value="sports">Sports club</option>
          <option value="charity">Charity group</option>
          <option value="other">Other community group</option>
        </select>
      </Field>
    </fieldset>
  );
}

function FundStep({ draft, setDraft }: StepProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-heading font-bold">Fund details</legend>
      <Field label="Fund purpose" id="onboarding-fund-purpose">
        <input
          id="onboarding-fund-purpose"
          className={inputClass}
          value={draft.purpose}
          onChange={(e) => setDraft(updateDraft(draft, "purpose", e.target.value))}
        />
      </Field>
      <Field label="Description (optional)" id="onboarding-fund-desc">
        <textarea
          id="onboarding-fund-desc"
          className={inputClass}
          value={draft.description}
          onChange={(e) => setDraft(updateDraft(draft, "description", e.target.value))}
        />
      </Field>
      <Field label="Target amount in paise" id="onboarding-fund-target">
        <input
          id="onboarding-fund-target"
          className={inputClass}
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft.targetPaise}
          onChange={(e) =>
            setDraft(updateDraft(draft, "targetPaise", e.target.value.replace(/[^0-9]/g, "")))
          }
        />
        <span className="text-small font-normal text-ink-muted">
          For example, 125000 for ₹1,250.00. No decimals.
        </span>
      </Field>
    </fieldset>
  );
}

function PaymentStep({ draft, setDraft }: StepProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-heading font-bold">Payment details</legend>
      <Field label="UPI VPA" id="onboarding-upi-vpa">
        <input
          id="onboarding-upi-vpa"
          className={inputClass}
          placeholder="club@bank"
          value={draft.upiVpa}
          onChange={(e) => setDraft(updateDraft(draft, "upiVpa", e.target.value))}
        />
      </Field>
      <Field label="Bank account or UPI payee name" id="onboarding-payee-name">
        <input
          id="onboarding-payee-name"
          className={inputClass}
          value={draft.payeeName}
          onChange={(e) => setDraft(updateDraft(draft, "payeeName", e.target.value))}
        />
      </Field>
    </fieldset>
  );
}

interface StepProps {
  draft: OnboardingDraft;
  setDraft: (draft: OnboardingDraft) => void;
}

function ApproverStep({ draft, setDraft }: StepProps) {
  const people = [...draft.approvers];
  const change = (index: number, key: keyof (typeof people)[number], value: string) => {
    const current = people[index];
    if (!current) return;
    people[index] = key === "name" ? { ...current, name: value } : { ...current, contact: value };
    setDraft(updateDraft(draft, "approvers", people));
  };
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-heading font-bold">Approvers</legend>
      <p className="text-body text-ink-muted">
        Nominate at least two people. A third is optional; two approvals are required.
      </p>
      {people.map((person, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional approver nomination slot
        <div key={index} className="grid gap-3 rounded-card border-2 border-border p-3">
          <Field label={`Approver ${index + 1} name`} id={`onboarding-approver-${index}-name`}>
            <input
              id={`onboarding-approver-${index}-name`}
              className={inputClass}
              value={person.name}
              onChange={(e) => change(index, "name", e.target.value)}
            />
          </Field>
          <Field
            label={`Approver ${index + 1} phone number`}
            id={`onboarding-approver-${index}-contact`}
          >
            <input
              id={`onboarding-approver-${index}-contact`}
              className={inputClass}
              placeholder="+919876543210"
              value={person.contact}
              onChange={(e) => change(index, "contact", e.target.value)}
            />
          </Field>
        </div>
      ))}
      {people.length < 3 ? (
        <button
          type="button"
          className="tap-target self-start rounded-control border-2 border-border px-3 font-semibold"
          onClick={() =>
            setDraft(updateDraft(draft, "approvers", [...people, { name: "", contact: "" }]))
          }
        >
          Add third approver
        </button>
      ) : null}
    </fieldset>
  );
}

function VisibilityStep({ draft, setDraft }: StepProps) {
  const options: Array<{ value: VisibilityPreset; label: string; detail: string }> = [
    { value: "public", label: "Public", detail: "Anyone can view the fund." },
    { value: "donors", label: "Donors only", detail: "Visible to people who contribute." },
    { value: "members", label: "Members only", detail: "Visible to club members." },
  ];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-heading font-bold">Who can see this fund?</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer gap-3 rounded-card border-2 border-border p-4"
        >
          <input
            className="mt-1"
            type="radio"
            name="visibility"
            value={option.value}
            checked={draft.visibility === option.value}
            onChange={() => setDraft(updateDraft(draft, "visibility", option.value))}
          />
          <span>
            <strong>{option.label}</strong>
            <span className="block text-ink-muted">{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Completion({ fundId, inviteLinks }: { fundId: string; inviteLinks: readonly string[] }) {
  return (
    <section
      className="mx-auto flex w-full max-w-xl flex-col gap-4 py-8"
      aria-labelledby="complete-title"
    >
      <h1 id="complete-title" className="text-display font-bold text-ink">
        Your fund is ready
      </h1>
      <p role="status" className="text-body text-ink-muted">
        Fund created. Invite your co-approvers to complete the 2-of-3 setup.
      </p>
      <a
        className="tap-target rounded-control bg-primary px-4 py-3 text-center font-semibold text-on-solid"
        href={`/funds/${fundId}`}
      >
        Open fund
      </a>
      {inviteLinks.map((link, index) => (
        <a
          key={link}
          className="tap-target rounded-control border-2 border-border px-4 py-3 text-center font-semibold text-primary"
          href={link}
        >
          Share approver invite {index + 1} on WhatsApp
        </a>
      ))}
    </section>
  );
}
