import { formatInr } from "@yen/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicFund } from "../../../components/fund/data";
import { PublicFundView } from "../../../components/fund/public-fund-view";

export type FundPageProps = {
  params: Promise<{
    fundId: string;
  }>;
};

export async function generateMetadata(props: FundPageProps): Promise<Metadata> {
  const { fundId } = await props.params;
  const fund = await getPublicFund(fundId);

  if (!fund) {
    return {
      title: "Fund Not Found · Yen",
      description: "The requested public transparency fund could not be found.",
    };
  }

  const title = `${fund.name} · ${fund.org.name} · Yen`;
  const description = `${fund.purpose} · Current balance: ${formatInr(fund.money.currentBalance)}`;
  const ogImageUrl = `/icons/icon-512.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/funds/${fundId}`,
      siteName: "Yen",
      images: [
        {
          url: ogImageUrl,
          width: 512,
          height: 512,
          alt: `${fund.name} public fund transparency overview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function PublicFundPage(props: FundPageProps) {
  const { fundId } = await props.params;
  const fund = await getPublicFund(fundId);

  if (!fund) {
    notFound();
  }

  return <PublicFundView fund={fund} />;
}
