import type { Metadata } from "next";
import { LegalPage } from "../../components/legal-page";
import { en } from "../../i18n/messages/en";

export const metadata: Metadata = {
  title: `${en.legal.privacy.title} · ${en.app.name}`,
  description: en.legal.privacy.intro,
};

export default function PrivacyPage() {
  return <LegalPage page="privacy" />;
}
