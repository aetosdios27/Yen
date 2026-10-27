import type { Locale } from "./locales";
import type { Messages } from "./messages/en";
import { en } from "./messages/en";
import { hi } from "./messages/hi";
import { pseudoLocalizeMessages } from "./pseudo";

export const catalog: Record<Locale, Messages> = {
  en,
  hi,
  "en-XA": pseudoLocalizeMessages(en),
};
