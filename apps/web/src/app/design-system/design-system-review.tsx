"use client";

import { paise } from "@yen/shared";
import { type ReactNode, useState } from "react";
import {
  Button,
  EmptyState,
  Input,
  Money,
  type Status,
  StatusBadge,
  Stepper,
  type StepperStep,
  Timeline,
  type TimelineItem,
  Toast,
} from "../../components";
import { type MessageKey, toIntlLocale, useDocumentTitle, useI18n } from "../../i18n";

const STATUSES: readonly Status[] = ["verified", "pending", "unmatched", "rejected"];

const TIMELINE_EVENTS: ReadonlyArray<{
  id: string;
  dateTime: string;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  tone: "positive" | "neutral";
}> = [
  {
    id: "donation",
    dateTime: "2026-10-24T10:30:00+05:30",
    titleKey: "timeline.donation",
    descriptionKey: "timeline.donationDetail",
    tone: "positive",
  },
  {
    id: "expense",
    dateTime: "2026-10-25T16:05:00+05:30",
    titleKey: "timeline.expense",
    descriptionKey: "timeline.expenseDetail",
    tone: "neutral",
  },
  {
    id: "payment",
    dateTime: "2026-10-26T09:15:00+05:30",
    titleKey: "timeline.payment",
    descriptionKey: "timeline.paymentDetail",
    tone: "positive",
  },
];

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-card border border-border bg-surface p-4"
    >
      <h2 id={id} className="text-title font-bold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-small text-ink-muted [overflow-wrap:anywhere]">{description}</p>
      <div className="mt-4 flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

export function DesignSystemReview() {
  const { locale, t } = useI18n();
  useDocumentTitle("metadata.designSystemTitle", "metadata.designSystemDescription");
  const [toastOpen, setToastOpen] = useState(false);

  const dateFormat = new Intl.DateTimeFormat(toIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  const timelineItems: TimelineItem[] = TIMELINE_EVENTS.map((event) => ({
    id: event.id,
    title: t(event.titleKey),
    description: t(event.descriptionKey),
    dateTime: event.dateTime,
    timestamp: dateFormat.format(new Date(event.dateTime)),
    tone: event.tone,
  }));

  const stepperSteps: StepperStep[] = [
    { id: "fund-details", label: t("stepper.fundDetails") },
    { id: "approvers", label: t("stepper.approvers") },
    { id: "review", label: t("stepper.review") },
  ];

  return (
    <div className="mx-auto w-full max-w-phone pb-6">
      <article
        aria-labelledby="design-system-title"
        className="min-w-0 rounded-card border border-border bg-canvas p-4 shadow-card"
      >
        <header className="border-b border-border pb-4">
          <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
            375 px · YEN-13
          </p>
          <h1 id="design-system-title" className="mt-1 text-heading font-bold text-ink">
            {t("designSystem.title")}
          </h1>
          <p className="mt-2 text-small text-ink-muted [overflow-wrap:anywhere]">
            {t("designSystem.intro")}
          </p>
          <p className="mt-3 rounded-control border border-border bg-surface px-3 py-2 text-small text-ink-muted [overflow-wrap:anywhere]">
            {t("designSystem.localeNote")}
          </p>
        </header>

        <div className="mt-6 flex min-w-0 flex-col gap-6">
          <Section
            id="foundations-title"
            title={t("designSystem.foundationsTitle")}
            description={t("designSystem.foundationsBody")}
          >
            <div>
              <h3 className="text-small font-semibold text-ink">{t("designSystem.typeTitle")}</h3>
              <div className="mt-2 flex flex-col gap-1">
                <p className="text-display font-bold leading-tight text-ink">
                  Aa · अ <span className="text-small font-normal text-ink-muted">36 px</span>
                </p>
                <p className="text-title font-semibold leading-tight text-ink">
                  Aa · अ <span className="text-small font-normal text-ink-muted">24 px</span>
                </p>
                <p className="text-body text-ink">
                  Aa · अ <span className="text-small text-ink-muted">18 px</span>
                </p>
                <p className="text-small text-ink-muted">Aa · अ 16 px</p>
              </div>
            </div>

            <div>
              <h3 className="text-small font-semibold text-ink">{t("designSystem.tapTitle")}</h3>
              <p className="text-small text-ink-muted">{t("designSystem.tapBody")}</p>
              <div className="tap-target mt-2 flex w-full items-center justify-center rounded-control border-2 border-dashed border-border-strong text-small text-ink">
                48 px
              </div>
            </div>

            <div>
              <h3 className="text-small font-semibold text-ink">
                {t("designSystem.contrastTitle")}
              </h3>
              <p className="text-small text-ink-muted">{t("designSystem.contrastBody")}</p>
              <div className="mt-2 flex flex-col gap-2 text-small text-ink">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-8 items-center justify-center rounded border border-border bg-canvas font-semibold text-ink"
                  >
                    Aa
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {t("designSystem.contrastInk")} · 16.4:1
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-8 items-center justify-center rounded border border-border bg-primary text-small font-semibold text-on-solid"
                  >
                    Aa
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {t("designSystem.contrastAction")} · 9.1:1
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-8 items-center justify-center rounded border border-border bg-surface text-small font-semibold text-ink-muted"
                  >
                    Aa
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {t("designSystem.contrastMuted")} · 7.3:1
                  </span>
                </div>
              </div>
            </div>
          </Section>

          <Section
            id="buttons-title"
            title={t("designSystem.buttonsTitle")}
            description={t("designSystem.buttonsBody")}
          >
            <Button className="w-full">{t("designSystem.buttonPrimary")}</Button>
            <Button variant="secondary" className="w-full">
              {t("designSystem.buttonSecondary")}
            </Button>
            <Button variant="danger" className="w-full">
              {t("designSystem.buttonDanger")}
            </Button>
            <Button variant="ghost" className="w-full">
              {t("designSystem.buttonGhost")}
            </Button>
            <Button loading className="w-full">
              {t("designSystem.buttonSaving")}
            </Button>
          </Section>

          <Section
            id="input-title"
            title={t("designSystem.inputTitle")}
            description={t("designSystem.inputBody")}
          >
            <Input
              label={t("designSystem.inputLabel")}
              name="donor-name"
              autoComplete="name"
              placeholder={t("designSystem.inputPlaceholder")}
              hint={t("designSystem.inputHint")}
            />
            <Input
              label={t("designSystem.inputErrorLabel")}
              name="donor-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t("designSystem.inputErrorPlaceholder")}
              hint={t("designSystem.inputErrorHint")}
              error={t("designSystem.inputError")}
            />
          </Section>

          <Section
            id="money-title"
            title={t("designSystem.moneyTitle")}
            description={t("designSystem.moneyBody")}
          >
            <div className="min-w-0 rounded-control bg-canvas p-3">
              <Money amount={paise(123456789012)} label={t("designSystem.moneyBalanceLabel")} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Money amount={paise(100550)} label={t("designSystem.moneyDonationLabel")} />
                <Money amount={paise(-5050)} label={t("designSystem.moneyRefundLabel")} />
              </div>
            </div>
          </Section>

          <Section
            id="status-title"
            title={t("designSystem.statusTitle")}
            description={t("designSystem.statusBody")}
          >
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <StatusBadge key={status} status={status} />
              ))}
            </div>
          </Section>

          <Section
            id="timeline-title"
            title={t("designSystem.timelineTitle")}
            description={t("designSystem.timelineBody")}
          >
            <Timeline items={timelineItems} label={t("designSystem.timelineLabel")} />
          </Section>

          <Section
            id="stepper-title"
            title={t("designSystem.stepperTitle")}
            description={t("designSystem.stepperBody")}
          >
            <Stepper steps={stepperSteps} current={2} label={t("designSystem.stepperLabel")} />
          </Section>

          <Section
            id="toast-title"
            title={t("designSystem.toastTitle")}
            description={t("designSystem.toastBody")}
          >
            <Button variant="secondary" className="w-full" onClick={() => setToastOpen(true)}>
              {t("designSystem.toastTrigger")}
            </Button>
            <Toast
              open={toastOpen}
              tone="success"
              title={t("designSystem.toastHeading")}
              description={t("designSystem.toastDescription")}
              onClose={() => setToastOpen(false)}
            />
          </Section>

          <Section
            id="empty-title"
            title={t("designSystem.emptyTitle")}
            description={t("designSystem.emptyBody")}
          >
            <EmptyState
              title={t("designSystem.emptyHeading")}
              description={t("designSystem.emptyDescription")}
              action={<Button variant="secondary">{t("designSystem.emptyAction")}</Button>}
            />
          </Section>
        </div>

        <p className="mt-6 border-t border-border pt-4 text-small text-ink-muted">
          {t("designSystem.footer")}
        </p>
      </article>
    </div>
  );
}
