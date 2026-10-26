import { z } from "zod";

export const paiseWire = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .describe("Nonnegative integer paise as a canonical decimal string; never a JSON number.");
