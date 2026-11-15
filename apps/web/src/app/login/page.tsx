"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { SESSION_CHANGED_EVENT } from "../../components/session-nav";
import { StatusBadge } from "../../components/status-badge";
import { useDocumentTitle, useI18n } from "../../i18n";

type Step = "phone" | "otp" | "pin" | "success";
type PinMode = "setup" | "unlock";

export default function LoginPage() {
  const { t } = useI18n();
  useDocumentTitle("auth.title", "auth.intro");

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [otp, setOtp] = useState("");
  const [simulatedCode, setSimulatedCode] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
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
        const simulated: unknown = data.simulatedDelivery?.code;
        setSimulatedCode(typeof simulated === "string" ? simulated : null);
        setOtp(typeof simulated === "string" ? simulated : "");
        setStep("otp");
        setCooldownRemaining(data.resendAfterSeconds ?? 60);
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

  const loadPinStep = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    let mode: PinMode | null = null;
    try {
      const statusRes = await fetch(`${apiUrl}/v1/auth/pin/status`, { credentials: "include" });
      if (statusRes.ok) {
        const status = await statusRes.json().catch(() => ({}));
        mode = status.isSet === true ? "unlock" : "setup";
      }
    } catch {
      mode = null;
    }
    setPinMode(mode);
    setErrorMessage(mode === null ? t("auth.errorGeneric") : null);
    setStep("pin");
  };

  const handleRetryPinStep = async () => {
    setLoading(true);
    try {
      await loadPinStep();
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
        await loadPinStep();
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

  const handleSubmitPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      setErrorMessage(t("auth.errorPinFormat"));
      return;
    }
    if (pinMode === "setup" && pin !== confirmPin) {
      setErrorMessage(t("auth.errorPinMismatch"));
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const path = pinMode === "setup" ? "/v1/auth/pin/setup" : "/v1/auth/device/unlock";
      const res = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin }),
      });

      if (res.ok) {
        window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
        setStep("success");
        setErrorMessage(null);
      } else if (res.status === 400) {
        setErrorMessage(t("auth.errorPinRejected"));
      } else if (res.status === 401) {
        const sessionAlive =
          pinMode === "unlock" &&
          (await fetch(`${apiUrl}/v1/auth/pin/status`, { credentials: "include" })).ok;
        if (sessionAlive) {
          setErrorMessage(t("auth.errorPinWrong"));
        } else {
          resetToPhoneStep();
          setErrorMessage(t("auth.errorSessionExpired"));
        }
      } else if (res.status === 429) {
        setErrorMessage(t("auth.errorRateLimited"));
      } else {
        setErrorMessage(t("auth.errorGeneric"));
      }
    } catch {
      setErrorMessage(t("auth.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const resetToPhoneStep = () => {
    setStep("phone");
    setOtp("");
    setPin("");
    setConfirmPin("");
    setPinMode(null);
    setSimulatedCode(null);
    setErrorMessage(null);
  };

  const handleChangePhone = resetToPhoneStep;

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

          {simulatedCode ? (
            <p
              role="status"
              className="rounded-control border-2 border-unmatched-border bg-unmatched-bg p-3 text-small font-medium text-unmatched-ink"
            >
              {t("auth.simulatedDeliveryNotice", { code: simulatedCode })}
            </p>
          ) : null}

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

      {step === "pin" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-display font-bold tracking-tight text-ink">
              {pinMode === "setup" ? t("auth.pinSetupTitle") : t("auth.pinUnlockTitle")}
            </h1>
            <p className="text-body text-ink-muted">
              {pinMode === "setup" ? t("auth.pinSetupIntro") : t("auth.pinUnlockIntro")}
            </p>
          </div>

          {pinMode === null ? (
            <div className="flex flex-col gap-5">
              {errorMessage ? (
                <p role="alert" className="text-small font-medium text-danger">
                  {errorMessage}
                </p>
              ) : null}
              <Button
                type="button"
                variant="primary"
                loading={loading}
                loadingLabel={t("auth.pinSubmitting")}
                onClick={handleRetryPinStep}
                className="w-full"
              >
                {t("auth.retry")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmitPin} className="flex flex-col gap-5" noValidate>
              <Input
                id="pin-input"
                label={t("auth.pinLabel")}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete={pinMode === "setup" ? "new-password" : "current-password"}
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                {...(errorMessage && pinMode === "unlock" ? { error: errorMessage } : {})}
                required
              />

              {pinMode === "setup" ? (
                <Input
                  id="pin-confirm-input"
                  label={t("auth.pinConfirmLabel")}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  {...(errorMessage ? { error: errorMessage } : {})}
                  required
                />
              ) : null}

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                loadingLabel={t("auth.pinSubmitting")}
                className="w-full"
              >
                {pinMode === "setup" ? t("auth.pinSetupSubmit") : t("auth.pinUnlockSubmit")}
              </Button>
            </form>
          )}

          <button
            type="button"
            onClick={resetToPhoneStep}
            className="tap-target py-2 text-center text-small font-semibold text-ink-muted hover:text-ink hover:underline"
          >
            {t("auth.startOver")}
          </button>
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
