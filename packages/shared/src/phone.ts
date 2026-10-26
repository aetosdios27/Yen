import * as z from "zod/mini";
import type { Result } from "./ids.js";

const phoneE164Schema = z
  .string()
  .check(z.regex(/^\+[1-9][0-9]{7,14}$/))
  .brand<"PhoneE164">();

export type PhoneE164 = z.infer<typeof phoneE164Schema>;

export function parsePhoneE164(input: unknown): Result<PhoneE164> {
  const parsed = phoneE164Schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "Expected canonical E.164 phone" };
}
