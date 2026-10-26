import type { Metadata } from "next";
import { DesignSystemReview } from "./design-system-review";

export const metadata: Metadata = {
  title: "Design system · Yen",
  description: "A 375 px review of Yen design tokens, components and languages.",
};

export default function DesignSystemPage() {
  return <DesignSystemReview />;
}
