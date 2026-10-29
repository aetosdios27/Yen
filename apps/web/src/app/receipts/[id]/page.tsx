import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type ReceiptData, ReceiptView } from "../../../components/receipt-view";

export const dynamic = "force-dynamic";

export interface ReceiptPageProps {
  params: Promise<{
    id: string;
  }>;
}

async function fetchReceipt(apiUrl: string, id: string): Promise<ReceiptData | null> {
  try {
    const response = await fetch(`${apiUrl}/v1/receipts/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to fetch receipt: HTTP ${response.status}`);
    }
    return (await response.json()) as ReceiptData;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

export async function generateMetadata(props: ReceiptPageProps): Promise<Metadata> {
  const { id } = await props.params;
  const { env } = await import("../../../env");
  const receipt = await fetchReceipt(env.NEXT_PUBLIC_API_URL, id).catch(() => null);

  if (!receipt) {
    return {
      title: "Receipt Not Found · Yen",
      description: "The requested donation receipt could not be found.",
    };
  }

  const title = `Donation Receipt · ${receipt.fundName} · Yen`;
  const description = `Verified contribution to ${receipt.fundName} via UPI (Reference: ${receipt.utr}).`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/receipts/${id}`,
      siteName: "Yen",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ReceiptPage(props: ReceiptPageProps) {
  const { id } = await props.params;
  const { env } = await import("../../../env");
  const receipt = await fetchReceipt(env.NEXT_PUBLIC_API_URL, id);

  if (!receipt) {
    notFound();
  }

  return <ReceiptView receipt={receipt} apiUrl={env.NEXT_PUBLIC_API_URL} />;
}
