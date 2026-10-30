"use client";

import { paise } from "@yen/shared";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { Input } from "./input";
import { Money } from "./money";
import { QrCode } from "./qr-code";
import { StatusBadge } from "./status-badge";

export interface ReceiptData {
  donationId: string;
  fundId: string;
  fundName: string;
  amountPaise: string;
  status: "verified" | "pledged" | "failed";
  utr: string;
  occurredAt: string;
  donorName?: string | undefined;
  verificationUrl: string;
  isTaxExempt: false;
  taxDisclaimer: {
    en: string;
    hi: string;
  };
  downloadUrls: {
    pdf: string;
    svg: string;
  };
}

export interface ReceiptViewProps {
  receipt: ReceiptData;
  apiUrl?: string | undefined;
  onSubscribe?:
    | ((subscription: {
        contact: string;
        contactType: "email" | "phone";
        channel: "email" | "whatsapp" | "sms";
        weeklySummary: boolean;
        instantAlerts: boolean;
      }) => Promise<boolean>)
    | undefined;
}

export function ReceiptView({ receipt, apiUrl = "", onSubscribe }: ReceiptViewProps) {
  const { t } = useI18n();
  const [destination, setDestination] = useState("");
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [instantAlerts, setInstantAlerts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const apiBase = apiUrl.replace(/\/+$/, "");
  const badgeStatus = receipt.status === "verified" ? "verified" : "pending";
  const formattedDate = new Date(receipt.occurredAt).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = destination.trim();
    if (trimmed === "") return;

    setSubmitting(true);
    setSubscribeError(null);

    const contactType: "email" | "phone" = trimmed.includes("@") ? "email" : "phone";
    const channel: "email" | "whatsapp" | "sms" = contactType === "email" ? "email" : "whatsapp";
    const payload = {
      contact: trimmed,
      contactType,
      channel,
      weeklySummary: weeklyDigest,
      instantAlerts,
    };

    try {
      if (onSubscribe) {
        const ok = await onSubscribe(payload);
        if (ok) {
          setSubscribed(true);
        } else {
          setSubscribeError(t("receipt.subscribeError"));
        }
      } else {
        const response = await fetch(
          `${apiBase}/v1/funds/${encodeURIComponent(receipt.fundId)}/subscriptions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (response.ok) {
          setSubscribed(true);
        } else {
          setSubscribeError(t("receipt.subscribeError"));
        }
      }
    } catch {
      setSubscribeError(t("receipt.subscribeError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      {/* Back navigation */}
      <nav aria-label="Breadcrumb">
        <Link
          href={`/funds/${receipt.fundId}`}
          className="tap-target inline-flex items-center text-small font-semibold text-primary underline-offset-4 hover:underline"
        >
          ← {t("receipt.backToFund")}
        </Link>
      </nav>

      {/* Main Certificate Card */}
      <section className="flex flex-col gap-6 rounded-card border-2 border-border bg-surface p-6 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading font-bold tracking-tight text-ink">
              {receipt.status === "verified"
                ? t("receipt.verifiedTitle")
                : t("receipt.pendingTitle")}
            </h1>
            <p className="text-small text-ink-muted">{receipt.fundName}</p>
          </div>
          <StatusBadge status={badgeStatus} />
        </header>

        {/* Certificate Details */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Money
            amount={paise(Number(receipt.amountPaise))}
            label={t("receipt.amountLabel")}
            className="sm:col-span-2"
          />

          <div className="flex flex-col gap-0.5">
            <span className="text-small font-medium text-ink-muted">{t("receipt.donorLabel")}</span>
            <span className="text-body font-semibold text-ink">
              {receipt.donorName ?? t("receipt.anonymousDonor")}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-small font-medium text-ink-muted">{t("receipt.dateLabel")}</span>
            <span className="text-body font-semibold text-ink">{formattedDate}</span>
          </div>

          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <span className="text-small font-medium text-ink-muted">{t("receipt.utrLabel")}</span>
            <code className="font-mono text-body font-bold text-ink">{receipt.utr}</code>
          </div>
        </div>

        {/* Scannable Vector QR Code */}
        <section
          aria-label={t("receipt.qrLabel")}
          className="flex flex-col items-center gap-3 rounded-control border-2 border-border bg-canvas p-4"
        >
          <QrCode value={receipt.verificationUrl} label={t("receipt.qrLabel")} />
          <p className="text-center text-small text-ink-muted">{t("receipt.qrLabel")}</p>
          <a
            href={receipt.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tap-target inline-flex items-center text-small font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("receipt.verifyLink")} ↗
          </a>
        </section>

        {/* Bilingual Non-80G Tax Disclaimer */}
        <aside
          role="note"
          aria-label={t("receipt.taxNoticeTitle")}
          className="flex flex-col gap-2 rounded-control border-2 border-border-strong bg-canvas p-4"
        >
          <h2 className="text-small font-bold text-ink">{t("receipt.taxNoticeTitle")}</h2>
          <p className="text-small text-ink">{receipt.taxDisclaimer.en}</p>
          <p lang="hi" className="text-small text-ink-muted">
            {receipt.taxDisclaimer.hi}
          </p>
        </aside>

        {/* Download Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={`${apiBase}${receipt.downloadUrls.pdf}`}
            download={`receipt-${receipt.utr}.pdf`}
            className="tap-target inline-flex flex-1 items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
          >
            {t("receipt.downloadPdf")}
          </a>
          <a
            href={`${apiBase}${receipt.downloadUrls.svg}`}
            download={`receipt-${receipt.utr}.svg`}
            className="tap-target inline-flex flex-1 items-center justify-center rounded-control border-2 border-primary bg-canvas px-5 py-3 text-body font-semibold text-primary hover:bg-primary-subtle"
          >
            {t("receipt.downloadSvg")}
          </a>
        </div>
      </section>

      {/* Follow this fund for updates */}
      <section className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-6 shadow-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-title font-bold text-ink">{t("receipt.followFundTitle")}</h2>
          <p className="text-body text-ink-muted">{t("receipt.followFundBody")}</p>
        </header>

        {subscribed ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-1 rounded-card border-2 border-verified-border bg-verified-bg p-4 text-verified-ink"
          >
            <p className="text-body font-bold">{t("receipt.subscribedTitle")}</p>
            <p className="text-small">{t("receipt.subscribedBody")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubscribe} noValidate className="flex flex-col gap-4">
            <Input
              id="follow-channel-destination"
              label={t("receipt.channelLabel")}
              hint={t("receipt.channelHint")}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="name@example.com or +919876543210"
              required
              autoComplete="off"
              error={subscribeError ?? undefined}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-small font-semibold text-ink">
                Notification preferences
              </legend>
              <label className="flex items-center gap-3 text-small font-medium text-ink">
                <input
                  type="checkbox"
                  checked={weeklyDigest}
                  onChange={(e) => setWeeklyDigest(e.target.checked)}
                  className="h-5 w-5 rounded border-2 border-border-strong text-primary"
                />
                <span>{t("receipt.prefWeekly")}</span>
              </label>
              <label className="flex items-center gap-3 text-small font-medium text-ink">
                <input
                  type="checkbox"
                  checked={instantAlerts}
                  onChange={(e) => setInstantAlerts(e.target.checked)}
                  className="h-5 w-5 rounded border-2 border-border-strong text-primary"
                />
                <span>{t("receipt.prefInstant")}</span>
              </label>
            </fieldset>

            <Button type="submit" loading={submitting} loadingLabel={t("receipt.subscribing")}>
              {t("receipt.subscribeButton")}
            </Button>
          </form>
        )}
      </section>
    </article>
  );
}
