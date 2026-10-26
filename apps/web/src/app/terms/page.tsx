import type { Metadata } from "next";
import { LegalPage } from "../../components/legal-page";
import { en } from "../../i18n/messages/en";

export const metadata: Metadata = {
  title: `${en.legal.terms.title} · ${en.app.name}`,
  description: en.legal.terms.intro,
};

export default function TermsPage() {
  return <LegalPage page="terms" />;
}
