export type VisibilityPreset = "public" | "donors" | "members";

export interface ApproverDraft {
  readonly name: string;
  readonly contact: string;
}

export interface OnboardingDraft {
  readonly clubName: string;
  readonly clubType: string;
  readonly purpose: string;
  readonly description: string;
  /** Canonical decimal paise, kept as text until it crosses the API boundary. */
  readonly targetPaise: string;
  readonly upiVpa: string;
  readonly payeeName: string;
  readonly approvers: readonly ApproverDraft[];
  readonly visibility: VisibilityPreset;
}

export const ONBOARDING_STORAGE_KEY = "yen:onboarding:draft:v1";

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
  clubName: "",
  clubType: "residents",
  purpose: "",
  description: "",
  targetPaise: "",
  upiVpa: "",
  payeeName: "",
  approvers: [{ name: "", contact: "" }, { name: "", contact: "" }],
  visibility: "members",
};

export function isCanonicalPaise(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

export function isUpiVpa(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(value.trim());
}

export function isApproverContact(value: string): boolean {
  return /^(?:\+?[1-9][0-9]{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(value.trim());
}

export function whatsappInviteLink(inviteUrl: string, clubName: string): string {
  const text = `Join ${clubName} as an approver. अपने क्लब के अनुमोदक बनें: ${inviteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
