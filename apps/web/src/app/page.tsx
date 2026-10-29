"use client";

import Link from "next/link";
import { WaitlistForm } from "../components/waitlist-form";
import { type MessageKey, useDocumentTitle, useI18n } from "../i18n";

const EXPLAINER: Array<{ titleKey: MessageKey; bodyKey: MessageKey }> = [
  { titleKey: "landing.explainer.whatTitle", bodyKey: "landing.explainer.whatBody" },
  { titleKey: "landing.explainer.editTitle", bodyKey: "landing.explainer.editBody" },
  { titleKey: "landing.explainer.checkTitle", bodyKey: "landing.explainer.checkBody" },
  { titleKey: "landing.explainer.moneyTitle", bodyKey: "landing.explainer.moneyBody" },
];

const STEPS: Array<{ titleKey: MessageKey; bodyKey: MessageKey }> = [
  { titleKey: "landing.steps.step1Title", bodyKey: "landing.steps.step1Body" },
  { titleKey: "landing.steps.step2Title", bodyKey: "landing.steps.step2Body" },
  { titleKey: "landing.steps.step3Title", bodyKey: "landing.steps.step3Body" },
];

export default function Home() {
  const { t } = useI18n();
  useDocumentTitle("metadata.appTitle", "metadata.appDescription");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 py-6">
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-display font-bold tracking-tight text-ink">
          {t("landing.hero.title")}
        </h1>
        <p className="text-lead text-ink-muted">{t("landing.hero.lead")}</p>
        <Link
          href="#waitlist"
          className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid transition-colors hover:bg-primary-hover"
        >
          {t("landing.hero.cta")}
        </Link>
      </section>

      <section aria-labelledby="explainer-title" className="flex flex-col gap-4">
        <h2 id="explainer-title" className="text-heading font-bold text-ink">
          {t("landing.explainer.title")}
        </h2>
        <p className="text-body text-ink-muted">{t("landing.explainer.intro")}</p>
        {EXPLAINER.map((item) => (
          <details
            key={item.titleKey}
            className="rounded-card border-2 border-border bg-surface p-4"
          >
            <summary className="tap-target flex cursor-pointer items-center text-body font-semibold text-ink">
              {t(item.titleKey)}
            </summary>
            <p className="mt-2 text-body text-ink-muted">{t(item.bodyKey)}</p>
          </details>
        ))}
      </section>

      <section aria-labelledby="steps-title" className="flex flex-col gap-4">
        <h2 id="steps-title" className="text-heading font-bold text-ink">
          {t("landing.steps.title")}
        </h2>
        <p className="text-body text-ink-muted">{t("landing.steps.intro")}</p>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step, index) => (
            <li
              key={step.titleKey}
              className="flex gap-4 rounded-card border-2 border-border bg-canvas p-4"
            >
              <span
                aria-hidden="true"
                className="tap-target flex shrink-0 items-center justify-center rounded-full bg-primary-subtle text-title font-bold text-primary"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-body font-semibold text-ink">{t(step.titleKey)}</h3>
                <p className="text-body text-ink-muted">{t(step.bodyKey)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="waitlist" aria-labelledby="waitlist-title" className="flex flex-col gap-4">
        <h2 id="waitlist-title" className="text-heading font-bold text-ink">
          {t("landing.waitlist.title")}
        </h2>
        <p className="text-body text-ink-muted">{t("landing.waitlist.intro")}</p>
        <WaitlistForm />
      </section>
    </div>
  );
}
