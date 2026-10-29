"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export function OwnerInviteAccept() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`${API_URL}/v1/auth/owner-invites/redeem`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, phone, displayName: name }),
    });
    if (!response.ok) return setMessage("This invite is invalid or has expired.");
    const result = (await response.json()) as {
      status: "pending_owner_confirmation" | "authenticated";
    };
    setMessage(
      result.status === "authenticated"
        ? "You are now an approver."
        : "Your nomination is awaiting confirmation.",
    );
  };

  if (!code)
    return (
      <p role="alert" className="py-8 text-body text-ink">
        This invite link is incomplete.
      </p>
    );

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4 py-8"
      onSubmit={(event) => void redeem(event)}
    >
      <h1 className="text-display font-bold text-ink">Join as an approver</h1>
      <p className="text-body text-ink-muted">
        अनुमोदक बनने के लिए अपना नाम और वही फोन नंबर दें जिस पर निमंत्रण भेजा गया था।
      </p>
      <div className="flex flex-col gap-2 font-semibold">
        <label htmlFor="invite-name">Name</label>
        <input
          id="invite-name"
          required
          className="tap-target rounded-control border-2 border-border px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 font-semibold">
        <label htmlFor="invite-phone">Phone number</label>
        <input
          id="invite-phone"
          required
          className="tap-target rounded-control border-2 border-border px-3"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      {message ? <p role="status">{message}</p> : null}
      <button
        className="tap-target rounded-control bg-primary px-4 font-semibold text-on-solid"
        type="submit"
      >
        Accept invite
      </button>
    </form>
  );
}
