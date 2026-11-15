"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { getApiBaseUrl } from "./api-client";

export const SESSION_CHANGED_EVENT = "yen:session-changed";
const personSchema = z.object({
  name: z.string().nullish(),
  displayName: z.string().nullish(),
  phone: z.string().nullish(),
});
const fundsSchema = z.object({
  funds: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      role: z.enum(["owner", "treasurer", "approver", "auditor", "member"]),
      visibility: z.enum(["public", "donors", "members", "private"]),
    }),
  ),
});
export type ProductFund = z.infer<typeof fundsSchema>["funds"][number];
export type ProductSession =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "error" }
  | { kind: "ready"; name: string | null; funds: ProductFund[] };

export function fundDestination(fund: ProductFund): string {
  const base = `/funds/${encodeURIComponent(fund.id)}`;
  return fund.role === "owner" || fund.role === "treasurer" || fund.role === "approver"
    ? `${base}/dashboard`
    : base;
}

export async function loadProductSession(signal?: AbortSignal): Promise<ProductSession> {
  const options: RequestInit = { credentials: "include", ...(signal ? { signal } : {}) };
  const me = await fetch(`${getApiBaseUrl()}/v1/me`, options);
  if (me.status === 401) return { kind: "signedOut" };
  if (!me.ok) throw new Error("Session unavailable");
  const person = personSchema.parse(await me.json());
  const response = await fetch(`${getApiBaseUrl()}/v1/me/funds`, options);
  if (response.status === 401) return { kind: "signedOut" };
  if (!response.ok) throw new Error("Funds unavailable");
  const { funds } = fundsSchema.parse(await response.json());
  return {
    kind: "ready",
    name: person.displayName?.trim() || person.name?.trim() || person.phone?.trim() || null,
    funds,
  };
}

export function useProductSession() {
  const [session, setSession] = useState<ProductSession>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const reload = () => {
      setSession({ kind: "loading" });
      setRevision((value) => value + 1);
    };
    window.addEventListener(SESSION_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, reload);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly invalidates the session after login or retry.
  useEffect(() => {
    const controller = new AbortController();
    loadProductSession(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ kind: "error" });
      });
    return () => controller.abort();
  }, [revision]);
  return { session, retry: () => setRevision((value) => value + 1) };
}
