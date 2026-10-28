import type { Metadata } from "next";
import { en } from "../../i18n/messages/en";
import { DesignSystemReview } from "./design-system-review";

export const metadata: Metadata = {
  title: en.metadata.designSystemTitle,
  description: en.metadata.designSystemDescription,
};

export default function DesignSystemPage() {
  return <DesignSystemReview />;
}
