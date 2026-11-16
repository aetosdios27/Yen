"use client";
// File selection and statement submission require browser state.
import { useState } from "react";
import { useI18n } from "../i18n";
import { getApiClient } from "../lib/api-client";
import { useProductSession } from "../lib/product-session";
import { Button } from "./button";

export function ExpenseBankMatch({ fundId, onMatched }: { fundId: string; onMatched: () => void }) {
  const { t } = useI18n();
  const { session } = useProductSession();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<"idle" | "saving" | "error" | "unmatched">("idle");
  const fund = session.kind === "ready" ? session.funds.find((item) => item.id === fundId) : null;
  if (!fund || (fund.role !== "owner" && fund.role !== "treasurer")) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || state === "saving") return;
    setState("saving");
    try {
      const result = await getApiClient().POST("/v1/reconciliation/statements", {
        headers: { "Idempotency-Key": key },
        body: { fundId, csvContent: await file.text() },
      });
      if (result.error) throw new Error(result.error.error.message);
      if (result.data.matchedCount === 0) setState("unmatched");
      else {
        setState("idle");
        onMatched();
      }
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-4">
      <h2 className="text-title font-semibold">{t("bankMatch.title")}</h2>
      <p className="text-small text-ink-muted">{t("bankMatch.description")}</p>
      <label htmlFor="bank-statement">{t("bankMatch.file")}</label>
      <input
        id="bank-statement"
        type="file"
        accept=".csv,text/csv"
        required
        disabled={state === "saving"}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setKey(crypto.randomUUID());
          setState("idle");
        }}
      />
      {state === "error" ? <p role="alert">{t("bankMatch.error")}</p> : null}
      {state === "unmatched" ? <p role="status">{t("bankMatch.unmatched")}</p> : null}
      <Button type="submit" disabled={!file || state === "saving"}>
        {t(state === "saving" ? "bankMatch.saving" : "bankMatch.submit")}
      </Button>
    </form>
  );
}
