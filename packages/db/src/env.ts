import * as z from "zod";

const databaseUrlSchema = z
  .string()
  .regex(/^\S+$/)
  .pipe(z.url({ protocol: /^postgres(?:ql)?$/, hostname: /^.+$/ }))
  .refine((url) => {
    try {
      // Postgres.js decodes URL components when constructing the client.
      decodeURI(url);
      return true;
    } catch {
      return false;
    }
  });

export function parseDatabaseUrl(
  value: unknown,
  name: "DATABASE_URL" | "YEN_DATABASE_URL" | "YEN_TEST_DATABASE_URL",
) {
  const parsed = databaseUrlSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${name} must be a valid PostgreSQL connection URL (postgres:// or postgresql:// with a host)`,
    );
  }
  return parsed.data;
}
