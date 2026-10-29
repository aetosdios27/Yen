import type { PseudonymId } from "./model.js";

const rawUserId: string = "00000000-0000-4000-8000-000000000001";
// @ts-expect-error A user ID or arbitrary string cannot be used as an event pseudonym.
const unsafePseudonym: PseudonymId = rawUserId;
void unsafePseudonym;
