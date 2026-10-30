"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { type MessageKey, useI18n } from "../i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export function OwnerInviteAccept() {
  const { t } = useI18n();
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<MessageKey | null>(null);

  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`${API_URL}/v1/auth/invites/redeem`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        phone: phone.trim(),
        displayName: name.trim(),
      }),
    });
    if (!response.ok) return setMessage("invite.invalid");
    const result = (await response.json()) as {
      status: "pending_owner_confirmation" | "authenticated";
    };
    setMessage(result.status === "authenticated" ? "invite.approved" : "invite.pending");
  };

  if (!code)
    return (
      <p role="alert" className="py-8 text-body text-ink">
        {t("invite.missingCode")}
      </p>
    );

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4 py-8"
      onSubmit={(event) => void redeem(event)}
    >
      <h1 className="text-display font-bold text-ink">{t("invite.title")}</h1>
      <p className="text-body text-ink-muted">{t("invite.intro")}</p>
      <div className="flex flex-col gap-2 font-semibold">
        <label htmlFor="invite-name">{t("invite.name")}</label>
        <input
          id="invite-name"
          required
          className="tap-target rounded-control border-2 border-border px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 font-semibold">
        <label htmlFor="invite-phone">{t("invite.phone")}</label>
        <input
          id="invite-phone"
          required
          className="tap-target rounded-control border-2 border-border px-3"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      {message ? <p role="status">{t(message)}</p> : null}
      <button
        className="tap-target rounded-control bg-primary px-4 font-semibold text-on-solid"
        type="submit"
      >
        {t("invite.submit")}
      </button>
    </form>
  );
}
