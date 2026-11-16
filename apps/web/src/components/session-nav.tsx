"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useI18n } from "../i18n";
import { getApiBaseUrl } from "../lib/api-client";
import { useProductSession } from "../lib/product-session";
import { LocaleSwitcher } from "./locale-switcher";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export { SESSION_CHANGED_EVENT } from "../lib/product-session";

export function SessionNav() {
  const { t } = useI18n();
  const { session } = useProductSession();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const fund =
    session.kind === "ready"
      ? session.funds.find((item) => pathname?.startsWith(`/funds/${encodeURIComponent(item.id)}`))
      : undefined;
  const signOut = async () => {
    setSigningOut(true);
    setLogoutError(false);
    try {
      const response = await fetch(`${getApiBaseUrl()}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setLogoutError(true);
      setSigningOut(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {fund && (
        <span className="mr-auto hidden max-w-full truncate text-small font-medium text-ink-muted sm:block">
          {fund.title}
        </span>
      )}
      {session.kind === "ready" && (
        <Link
          href="/"
          className="tap-target hidden items-center text-small font-medium text-ink-muted sm:inline-flex"
        >
          {t("product.allFunds")}
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="max-w-52 truncate"
            aria-label={
              session.kind === "ready"
                ? `${t("product.account")}: ${session.name || t("product.member")}`
                : t("product.account")
            }
          >
            {session.kind === "ready" ? session.name || t("product.member") : t("product.account")}{" "}
            <span aria-hidden="true">⌄</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            {session.kind === "ready"
              ? t("nav.signedInAs", { name: session.name || t("product.member") })
              : t("product.account")}
          </DropdownMenuLabel>
          {session.kind === "ready" && (
            <DropdownMenuItem asChild className="min-h-12 sm:hidden">
              <Link href="/">{t("product.allFunds")}</Link>
            </DropdownMenuItem>
          )}
          <div className="px-2 py-3">
            <LocaleSwitcher />
          </div>
          <DropdownMenuSeparator />
          {session.kind === "ready" ? (
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
              }}
              className="min-h-12"
            >
              {t("nav.signOut")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild className="min-h-12">
              <Link href="/login">{t("nav.login")}</Link>
            </DropdownMenuItem>
          )}
          {logoutError && (
            <p role="alert" className="px-2 py-2 text-small text-danger">
              {t("auth.errorGeneric")}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
