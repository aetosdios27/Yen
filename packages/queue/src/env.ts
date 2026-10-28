import { parseDatabaseUrl } from "@yen/db";
import * as z from "zod";
import { DEFAULT_SCHEMA } from "./config.js";

// pg-boss interpolates the schema name into SQL, so only plain identifiers are accepted.
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export const workerEnvSchema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).transform((value, ctx) => {
    try {
      return parseDatabaseUrl(value, "DATABASE_URL");
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "DATABASE_URL is invalid",
      });
      return z.NEVER;
    }
  }),
  QUEUE_SCHEMA: z
    .string()
    .regex(
      SCHEMA_NAME_PATTERN,
      "QUEUE_SCHEMA must be 1-63 lowercase letters, digits or underscores, not starting with a digit",
    )
    .default(DEFAULT_SCHEMA),
  QUEUE_MIGRATE: z
    .enum(["true", "false"], { error: "QUEUE_MIGRATE must be exactly 'true' or 'false'" })
    .default("false")
    .transform((value) => value === "true"),
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/**
 * Validates the worker process environment at the process boundary.
 * Throws an Error whose message names every invalid variable and never echoes a value.
 */
export function parseWorkerEnv(env: NodeJS.ProcessEnv): WorkerEnv {
  const result = workerEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid worker environment: ${problems}`);
  }
  return result.data;
}
