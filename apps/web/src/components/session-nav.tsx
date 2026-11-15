"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getApiBaseUrl } from "../lib/api-client";

export const SESSION_CHANGED_EVENT = "yen:session-changed";

export function SessionNav() {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch(`${getApiBaseUrl()}/v1/me`, { credentials: "include", signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const me: { displayName?: string; phone?: string } = await res.json();
          setDisplayName(me.displayName ?? me.phone ?? "");
        })
        .catch(() => undefined);
    load();
    window.addEventListener(SESSION_CHANGED_EVENT, load);
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_CHANGED_EVENT, load);
    };
  }, []);

  const signOut = async () => {
    await fetch(`${getApiBaseUrl()}/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    window.location.assign("/login");
  };

  if (displayName === null) {
    return (
      <Link
        href="/login"
        className="tap-target inline-flex items-center rounded-control text-small font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t("nav.login")}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-small font-medium text-ink-muted">
        {t("nav.signedInAs", { name: displayName })}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="tap-target inline-flex items-center rounded-control text-small font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t("nav.signOut")}
      </button>
    </div>
  );
}
