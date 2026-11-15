"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useDocumentTitle, useI18n } from "../i18n";
import { fundDestination, useProductSession } from "../lib/product-session";

export default function Home() {
  const { t } = useI18n();
  const router = useRouter();
  const { session, retry } = useProductSession();
  useDocumentTitle("metadata.appTitle", "metadata.appDescription");
  useEffect(() => {
    if (session.kind === "ready" && session.funds.length === 1 && session.funds[0])
      router.replace(fundDestination(session.funds[0]));
  }, [session, router]);
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("product.funds")}</h1>
        <p className="mt-2 text-body text-ink-muted">{t("product.intro")}</p>
      </div>
      {session.kind === "loading" && <p role="status">{t("product.loading")}</p>}
      {session.kind === "error" && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p role="alert">{t("product.error")}</p>
            <Button onClick={retry}>{t("auth.retry")}</Button>
          </CardContent>
        </Card>
      )}
      {session.kind === "signedOut" && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p>{t("product.signInIntro")}</p>
            <Button asChild>
              <Link href="/login">{t("nav.login")}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {session.kind === "ready" && session.funds.length === 0 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">{t("product.emptyTitle")}</h2>
            <p className="text-ink-muted">{t("product.emptyBody")}</p>
            <Button asChild>
              <Link href="/onboarding">{t("product.createFund")}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {session.kind === "ready" && session.funds.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {session.funds.map((fund) => (
            <Link
              key={fund.id}
              href={fundDestination(fund)}
              className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 hover:bg-canvas"
            >
              <span className="min-w-0">
                <span className="block break-words font-semibold">{fund.title}</span>
                <span className="text-small text-ink-muted">{t(`product.roles.${fund.role}`)}</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
