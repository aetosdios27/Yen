import type { Metadata } from "next";
import { UnsubscribeClient } from "./unsubscribe-client";

export const dynamic = "force-dynamic";

export interface UnsubscribePageProps {
  searchParams: Promise<{
    token?: string | undefined;
  }>;
}

export const metadata: Metadata = {
  title: "Unsubscribe · Yen",
  description: "Unsubscribe from fund spending updates and notifications.",
};

export default async function UnsubscribePage(props: UnsubscribePageProps) {
  const { token } = await props.searchParams;
  const { env } = await import("../../env");

  return <UnsubscribeClient initialToken={token} apiUrl={env.NEXT_PUBLIC_API_URL} />;
}
