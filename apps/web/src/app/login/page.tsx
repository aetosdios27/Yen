"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { StatusBadge } from "../../components/status-badge";
import { useDocumentTitle, useI18n } from "../../i18n";

type Step = "phone" | "otp" | "success";

export default function LoginPage() {
  const { t } = useI18n();
  useDocumentTitle("auth.title", "auth.intro");

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Resend cooldown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleSendOtp = async (e?: FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    const cleanPhone = phone.replace(/[\s-]/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      setErrorMessage(t("auth.errorPhoneRequired"));
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiUrl}/v1/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone, channel }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setStep("otp");
        setCooldownRemaining(data.resendCooldownSeconds ?? 60);
        setErrorMessage(null);
      } else if (res.status === 429) {
        setErrorMessage(t("auth.errorRateLimited"));
        if (data.retryAfterSeconds) {
          setCooldownRemaining(data.retryAfterSeconds);
        }
      } else {
        setErrorMessage(
          data.error === "INVALID_PHONE" ? t("auth.errorInvalidPhone") : t("auth.errorGeneric"),
        );
      }
    } catch {
      setErrorMessage(t("auth.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      setErrorMessage(t("auth.errorOtpInvalid"));
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const cleanPhone = phone.replace(/[\s-]/g, "");
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiUrl}/v1/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: cleanPhone, code: cleanOtp }),
      });

      await res.json().catch(() => ({}));

      if (res.ok) {
        setStep("success");
        setErrorMessage(null);
      } else if (res.status === 410) {
        setErrorMessage(t("auth.errorOtpExpired"));
      } else if (res.status === 429) {
        setErrorMessage(t("auth.errorRateLimited"));
      } else {
        // Clear error copy per requirement: "Wrong code, try again"
        setErrorMessage(t("auth.errorOtpInvalid"));
      }
    } catch {
      setErrorMessage(t("auth.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePhone = () => {
    setStep("phone");
    setOtp("");
    setErrorMessage(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-stretch gap-6 py-8">
      {step === "phone" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-display font-bold tracking-tight text-ink">{t("auth.title")}</h1>
            <p className="text-body text-ink-muted">{t("auth.intro")}</p>
          </div>

          <form onSubmit={handleSendOtp} className="flex flex-col gap-5" noValidate>
            <Input
              id="phone-input"
              label={t("auth.phoneLabel")}
              placeholder={t("auth.phonePlaceholder")}
              hint={t("auth.phoneHint")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              {...(errorMessage ? { error: errorMessage } : {})}
              required
            />

            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              {t("auth.channelLabel")}
              <select
                aria-label={t("auth.channelLabel")}
                className="min-h-11 rounded-md border border-line bg-surface px-3 text-ink"
                value={channel}
                onChange={(event) => setChannel(event.target.value as "whatsapp" | "sms")}
              >
                <option value="whatsapp">{t("auth.channelWhatsapp")}</option>
                <option value="sms">{t("auth.channelSms")}</option>
              </select>
            </label>

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              loadingLabel={t("auth.sendingOtp")}
              className="w-full"
            >
              {t("auth.sendOtp")}
            </Button>
          </form>
        </>
      )}

      {step === "otp" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-display font-bold tracking-tight text-ink">{t("auth.otpTitle")}</h1>
            <p className="text-body text-ink-muted">{t("auth.otpIntro", { phone })}</p>
          </div>

          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-5" noValidate>
            <Input
              id="otp-input"
              label={t("auth.otpLabel")}
              placeholder={t("auth.otpPlaceholder")}
              hint={t("auth.otpHint")}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              {...(errorMessage ? { error: errorMessage } : {})}
              required
            />

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              loadingLabel={t("auth.verifyingOtp")}
              className="w-full"
            >
              {t("auth.verifyOtp")}
            </Button>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={cooldownRemaining > 0 || loading}
                onClick={() => handleSendOtp()}
                className="w-full"
              >
                {cooldownRemaining > 0
                  ? t("auth.resendCooldown", { seconds: cooldownRemaining })
                  : t("auth.resendOtp")}
              </Button>

              <button
                type="button"
                onClick={handleChangePhone}
                className="tap-target py-2 text-center text-small font-semibold text-ink-muted hover:text-ink hover:underline"
              >
                {t("auth.changePhone")}
              </button>
            </div>
          </form>
        </>
      )}

      {step === "success" && (
        <div className="flex flex-col items-center gap-4 text-center py-6">
          <StatusBadge status="verified" />
          <h1 className="text-display font-bold tracking-tight text-ink">
            {t("auth.successHeading")}
          </h1>
          <p className="text-lead text-ink-muted">{t("auth.successDescription")}</p>
          <Link
            href="/"
            className="tap-target mt-4 inline-flex w-full items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
          >
            {t("nav.primary")}
          </Link>
        </div>
      )}
    </div>
  );
}
