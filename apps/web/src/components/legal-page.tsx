"use client";

import { type MessageKey, useDocumentTitle, useI18n } from "../i18n";

export type LegalPageName = "terms" | "privacy";

const SECTIONS: Record<LegalPageName, Array<[MessageKey, MessageKey]>> = {
  terms: [
    ["legal.terms.serviceTitle", "legal.terms.serviceBody"],
    ["legal.terms.moneyTitle", "legal.terms.moneyBody"],
    ["legal.terms.usingTitle", "legal.terms.usingBody"],
    ["legal.terms.publicTitle", "legal.terms.publicBody"],
    ["legal.terms.pilotTitle", "legal.terms.pilotBody"],
  ],
  privacy: [
    ["legal.privacy.collectTitle", "legal.privacy.collectBody"],
    ["legal.privacy.whyTitle", "legal.privacy.whyBody"],
    ["legal.privacy.publicTitle", "legal.privacy.publicBody"],
    ["legal.privacy.storageTitle", "legal.privacy.storageBody"],
    ["legal.privacy.trackingTitle", "legal.privacy.trackingBody"],
    ["legal.privacy.rightsTitle", "legal.privacy.rightsBody"],
    ["legal.privacy.changesTitle", "legal.privacy.changesBody"],
  ],
};

const HEADINGS: Record<LegalPageName, MessageKey> = {
  terms: "legal.terms.title",
  privacy: "legal.privacy.title",
};

const INTROS: Record<LegalPageName, MessageKey> = {
  terms: "legal.terms.intro",
  privacy: "legal.privacy.intro",
};

const UPDATES: Record<LegalPageName, MessageKey> = {
  terms: "legal.terms.updated",
  privacy: "legal.privacy.updated",
};

export function LegalPage({ page }: { page: LegalPageName }) {
  const { t } = useI18n();
  useDocumentTitle(HEADINGS[page], INTROS[page]);

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-bold text-ink">{t(HEADINGS[page])}</h1>
        <p className="text-small text-ink-muted">{t(UPDATES[page])}</p>
        <p className="text-body text-ink-muted">{t(INTROS[page])}</p>
      </header>
      {SECTIONS[page].map(([headingKey, bodyKey]) => (
        <section key={headingKey} className="flex flex-col gap-2">
          <h2 className="text-title font-bold text-ink">{t(headingKey)}</h2>
          <p className="text-body text-ink-muted">{t(bodyKey)}</p>
        </section>
      ))}
    </article>
  );
}
