/**
 * English message catalogue. This file is the source of truth for both the
 * message shape and every typed key: Hindi and the pseudo-locale must provide
 * exactly these strings.
 */
export const en = {
  app: {
    name: "Yen",
  },
  metadata: {
    appTitle: "Yen",
    appDescription: "Community money you can check.",
    designSystemTitle: "Design system · Yen",
    designSystemDescription: "A 375 px review of Yen design tokens, components and languages.",
  },
  common: {
    skipToContent: "Skip to main content",
    loading: "Loading",
    dismiss: "Dismiss",
  },
  nav: {
    primary: "Primary",
    designSystem: "Design system",
  },
  locale: {
    label: "Language",
    en: "English",
    hi: "हिन्दी",
    "en-XA": "Pseudo (test)",
  },
  home: {
    title: "Yen",
    intro: "Community money you can check. Every record stays visible to the people who gave.",
    designSystemCta: "Review the design system",
  },
  designSystem: {
    title: "Design system",
    intro:
      "Shared tokens and components at a 375 px phone width. Every control is at least 48 px tall, works from the keyboard, and switches language without a page reload.",
    localeNote: "Change the language in the header. This page updates instantly.",
    foundationsTitle: "Foundations",
    foundationsBody: "Type, touch targets and contrast at a glance.",
    typeTitle: "Type scale",
    typeBody: "Body text stays at 18 px, with a 16 px minimum for supporting text.",
    tapTitle: "Tap targets",
    tapBody: "Buttons and inputs use a 48 px minimum height.",
    contrastTitle: "Contrast",
    contrastBody: "Body text meets 4.5:1; action and status text meet 7:1.",
    contrastInk: "Text",
    contrastAction: "Action",
    contrastMuted: "Supporting text",
    buttonsTitle: "Buttons",
    buttonsBody: "Primary, secondary, danger, ghost and loading states.",
    buttonPrimary: "Record a donation",
    buttonSecondary: "View fund",
    buttonDanger: "Cancel request",
    buttonGhost: "See all records",
    buttonSaving: "Saving",
    inputTitle: "Text input",
    inputBody: "A visible label, help text and an error announced to screen readers.",
    inputLabel: "Donor name",
    inputPlaceholder: "Asha Rao",
    inputHint: "Use the name shown on the bank statement.",
    inputErrorLabel: "Donor phone",
    inputErrorPlaceholder: "98765 43210",
    inputErrorHint: "We only use this to send the receipt.",
    inputError: "Enter a 10-digit phone number.",
    moneyTitle: "Money",
    moneyBody: "Exact to the paisa, with Indian digit grouping.",
    moneyBalanceLabel: "Fund balance",
    moneyDonationLabel: "Donation",
    moneyRefundLabel: "Refund",
    statusTitle: "Status labels",
    statusBody: "Every status pairs a word with a distinct shape, never colour alone.",
    timelineTitle: "Record history",
    timelineLabel: "Record history",
    timelineBody: "Oldest to newest, with the time each change was recorded.",
    stepperTitle: "Step indicator",
    stepperLabel: "Fund setup progress",
    stepperBody: "Three-step setup, currently on step two.",
    toastTitle: "Notifications",
    toastBody: "A notification that politely announces a saved change.",
    toastTrigger: "Show toast",
    toastHeading: "Fund saved",
    toastDescription: "The updated details are visible to every member.",
    emptyTitle: "Empty lists",
    emptyBody: "A clear next action when a list has no records yet.",
    emptyHeading: "No expenses yet",
    emptyDescription: "When the treasurer records a bill, it will appear here.",
    emptyAction: "Record an expense",
    footer: "Yen design system · YEN-13",
  },
  status: {
    verified: "Verified",
    pending: "Pending review",
    unmatched: "No approval found",
    rejected: "Rejected",
  },
  timeline: {
    donation: "Donation received",
    donationDetail: "The bank confirmed ₹5,000.00.",
    expense: "Expense approved",
    expenseDetail: "Three approvers confirmed the bill.",
    payment: "Bank payment matched",
    paymentDetail: "The payment matches an approved request.",
  },
  stepper: {
    fundDetails: "Fund details",
    approvers: "Approvers",
    review: "Review",
    completed: "Completed",
    step: "Step {current} of {total}: {label}",
  },
} as const;

type DeepString<T> = T extends string ? string : { readonly [K in keyof T]: DeepString<T[K]> };

export type Messages = DeepString<typeof en>;

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** Every dot-separated message key, checked at compile time. */
export type MessageKey = LeafPaths<Messages>;
