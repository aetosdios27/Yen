import { chainHead, hashHexSchema } from "@yen/eventlog";
import { parseFundId } from "@yen/shared";
import { createSql } from "./client.ts";
import { parseDatabaseUrl } from "./env.ts";
import { checkStoredChainStructure, verifyStoredChain } from "./events.ts";

export const HELP_TEXT = `Usage: verify-chain <fund-id> [--head <hash> --count <count>]

Recomputes the fund event chain from the database in sequence order
and checks hash linkage and canonical envelope structure.

Options:
  --head <hex>     Optional expected latest event hash (64 hex lowercase).
  --count <int>    Optional expected event count (nonnegative integer).
  --help, -h       Show this help message.

IMPORTANT: This CLI performs an internal database consistency check.
It is NOT an authenticity proof. A database consistency check alone
cannot prove authenticity without an externally authenticated checkpoint
(such as an on-chain anchored global root).
`;

export async function runVerifyCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  out: { log: (msg: string) => void; error: (msg: string) => void } = console,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    out.log(HELP_TEXT);
    return 0;
  }

  let fundIdStr: string | undefined;
  let headHashStr: string | undefined;
  let countStr: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--head") {
      headHashStr = args[++i];
    } else if (arg === "--count") {
      countStr = args[++i];
    } else if (arg?.startsWith("-")) {
      out.error(`Unknown option: ${arg}\n\n${HELP_TEXT}`);
      return 1;
    } else if (fundIdStr === undefined) {
      fundIdStr = arg;
    } else {
      out.error(`Unexpected extra argument: ${arg}\n\n${HELP_TEXT}`);
      return 1;
    }
  }

  if (fundIdStr === undefined) {
    out.error(`Missing required <fund-id> argument.\n\n${HELP_TEXT}`);
    return 1;
  }

  const parsedFund = parseFundId(fundIdStr);
  if (!parsedFund.ok) {
    out.error(`Invalid fund ID: ${parsedFund.error}`);
    return 1;
  }
  const fundId = parsedFund.value;

  const url = parseDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  const sql = createSql(url);

  try {
    if (headHashStr !== undefined || countStr !== undefined) {
      if (headHashStr === undefined || countStr === undefined) {
        out.error("Both --head and --count must be provided together.");
        return 1;
      }
      const count = Number(countStr);
      if (!Number.isSafeInteger(count) || count < 0) {
        out.error(`Invalid count: ${countStr} (must be nonnegative integer)`);
        return 1;
      }
      const parsedHeadHash = hashHexSchema.safeParse(headHashStr);
      if (!parsedHeadHash.success) {
        out.error(`Invalid head hash: ${headHashStr} (must be 64-char lowercase hex)`);
        return 1;
      }
      const expectedHead = chainHead({
        fundId,
        count,
        latestHash: parsedHeadHash.data,
      });

      const result = await verifyStoredChain(sql, fundId, expectedHead);
      if (result.ok) {
        out.log(
          `Chain verified against expected head: count=${result.count} latestHash=${result.latestHash}`,
        );
        return 0;
      }
      out.error(
        `Chain verification break at index=${result.index} seq=${result.seq ?? "null"}: ${result.reason}`,
      );
      return 1;
    }

    // Consistency check without external head
    const result = await checkStoredChainStructure(sql, fundId);
    if (result.status === "structure-consistent") {
      out.log(
        `Chain structure consistent: count=${result.observedHead.count} latestHash=${result.observedHead.latestHash}`,
      );
      return 0;
    }
    out.error(
      `Chain structure break at index=${result.index} seq=${result.seq ?? "null"}: ${result.reason}`,
    );
    return 1;
  } finally {
    await sql.end();
  }
}

// When invoked directly from the CLI
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/verify-cli.ts") || process.argv[1].endsWith("/verify-cli.js"));

if (isMain) {
  const exitCode = await runVerifyCli(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
