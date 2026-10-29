import { createSql } from "./client.ts";
import { parseDatabaseUrl } from "./env.ts";
import { runRetentionJob } from "./retention.ts";

export async function runRetentionCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  out: { log: (message: string) => void; error: (message: string) => void } = console,
) {
  const dryRun = args.includes("--dry-run");
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--help" && arg !== "-h")) {
    out.error("Usage: retention [--dry-run]");
    return 1;
  }
  if (args.includes("--help") || args.includes("-h")) {
    out.log("Usage: retention [--dry-run]\nDefault: purge expired operational records.");
    return 0;
  }
  const url = parseDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  const sql = createSql(url);
  try {
    const report = await runRetentionJob(sql, { dryRun });
    out.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    out.error(error instanceof Error ? error.message : "Retention job failed");
    return 1;
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1]?.endsWith("/retention-cli.ts") ||
  process.argv[1]?.endsWith("/retention-cli.js")
) {
  process.exitCode = await runRetentionCli(process.argv.slice(2));
}
