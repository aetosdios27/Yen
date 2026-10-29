#!/usr/bin/env node

import { createSql, migrate, uuidv7 } from "@yen/db";
import { chainHead, verifyChainStream } from "@yen/eventlog";
import { getBalances, recordDonation, reserveForExpense } from "@yen/ledger";
import { paise } from "@yen/shared";
import { initLedgerSchema } from "../dist/schema.js";

function integerArg(name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

const ops = integerArg("ops", 1_000_000, 1);
const seed = integerArg("seed", 49049, 0, 0xffff_ffff);
const batchSize = integerArg("batch", 100, 1, 10_000);
const url = process.env.YEN_TEST_DATABASE_URL;
if (!url) throw new Error("Set YEN_TEST_DATABASE_URL to a disposable Postgres 16 database");
for (const arg of process.argv.slice(2).filter((value) => value !== "--")) {
  if (!["--ops", "--seed", "--batch"].includes(arg) && !/^\d+$/.test(arg)) {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

// xorshift32 keeps the generated operation stream reproducible without retaining it.
let state = (seed || 0x6d2b79f5) >>> 0;
function nextAmount() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 10_000) + 1;
}

const sql = createSql(url, { max: 1 });
const started = performance.now();
let completed = 0;
let violations = 0;
let lastProgress = 0;
let totalDonations = 0;
let totalHolds = 0;
let expectedBank = 0n;
let expectedPending = 0n;
try {
  await migrate(sql);
  await initLedgerSchema(sql);
  const userId = uuidv7();
  const orgId = uuidv7();
  const fundId = uuidv7();
  const phone = `+1${((BigInt(`0x${userId.replaceAll("-", "")}`) % 900_000_000_000n) + 100_000_000_000n).toString()}`;
  await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Invariant load')`;
  await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Invariant load', 'individual', ${userId})`;
  await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Invariant load', '{}')`;
  let lastEntrySequence = Number(
    (await sql`SELECT COALESCE(MAX(entry_sequence), 0)::int AS sequence FROM konto_entries`)[0]
      .sequence,
  );

  while (completed < ops) {
    const count = Math.min(batchSize, ops - completed);
    let donationCount = 0;
    let expectedBatchAmount = 0;
    await sql.begin(async (tx) => {
      for (let offset = 0; offset < count; offset += 1) {
        const index = completed + offset;
        // A hold is only attempted when the fund can cover it. The ledger refuses to
        // overdraw (KontoInsufficientFundsError), which is correct behavior, so a seed
        // that starts with a hold on an empty fund must fall back to a donation instead
        // of crashing the run.
        const wantsHold = nextAmount() % 5 === 0;
        const holdAmount = wantsHold ? (nextAmount() % 1000) + 1 : 0;
        if (wantsHold && expectedBank - expectedPending >= BigInt(holdAmount)) {
          await reserveForExpense(tx, { fundId, amount: paise(holdAmount) });
          totalHolds += 1;
          expectedPending += BigInt(holdAmount);
        } else {
          const amount = nextAmount();
          donationCount += 1;
          totalDonations += 1;
          expectedBatchAmount += amount;
          expectedBank += BigInt(amount);
          await recordDonation(tx, {
            fundId,
            amount: paise(amount),
            donationId: uuidv7(),
            bankTransactionId: uuidv7(),
            reference: `load-${seed}-${index}`,
          });
        }
      }
    });
    completed += count;

    const batchRows = await sql`
      SELECT a.name, e.journal_id, e.amount::text,
        SUM(e.amount) OVER (PARTITION BY e.journal_id)::text AS journal_total
      FROM konto_entries e JOIN konto_accounts a ON a.id = e.account_id
      WHERE e.entry_sequence > ${lastEntrySequence}
        AND a.name IN (${`fund:${fundId}:bank`}, ${`fund:${fundId}:donations`})
      ORDER BY e.entry_sequence
    `;
    const expectedEntries = donationCount * 2;
    const batchBank = batchRows
      .filter((row) => row.name === `fund:${fundId}:bank`)
      .reduce((sum, row) => sum + BigInt(row.amount), 0n);
    const batchDonations = batchRows
      .filter((row) => row.name === `fund:${fundId}:donations`)
      .reduce((sum, row) => sum - BigInt(row.amount), 0n);
    if (
      batchRows.length !== expectedEntries ||
      batchBank !== BigInt(expectedBatchAmount) ||
      batchDonations !== BigInt(expectedBatchAmount) ||
      batchRows.some((row) => row.journal_total !== "0")
    ) {
      violations += 1;
      throw new Error(
        `Invariant violation after ${completed} operations: batch entries=${batchRows.length}, expected=${expectedEntries}, bank=${batchBank}, donations=${batchDonations}`,
      );
    }
    lastEntrySequence = Number(
      (await sql`SELECT COALESCE(MAX(entry_sequence), 0)::int AS sequence FROM konto_entries`)[0]
        .sequence,
    );
    const elapsed = (performance.now() - started) / 1000;
    const progressInterval = Math.max(batchSize, 5_000);
    if (completed - lastProgress >= progressInterval || completed === ops) {
      process.stdout.write(
        `progress ops=${completed}/${ops} seed=${seed} elapsed=${elapsed.toFixed(1)}s\n`,
      );
      lastProgress = completed;
    }
  }

  const headRows = await sql`
    SELECT seq::text AS seq_text, hash FROM fund_events WHERE fund_id = ${fundId} ORDER BY seq DESC LIMIT 1
  `;
  const headRow = headRows[0];
  const events = sql`
    SELECT fund_id, seq::int AS seq, version, type, actor, occurred_at::text AS occurred_at, payload, prev_hash, hash
    FROM fund_events WHERE fund_id = ${fundId} ORDER BY seq ASC
  `.cursor(500);
  async function* eventStream() {
    for await (const batch of events) for (const event of batch) yield event;
  }
  if (!headRow) throw new Error("Expected events from the completed operation run");
  const verification = await verifyChainStream(
    eventStream(),
    chainHead({ fundId: fundId, count: Number(headRow.seq_text), latestHash: headRow.hash }),
  );
  if (!verification.ok || verification.count !== ops * 2) {
    violations += 1;
    throw new Error(`Event chain invariant failed: ${JSON.stringify(verification)}`);
  }
  const balances = await getBalances(sql, fundId);
  const expectedTotals = await sql`
    SELECT COALESCE(SUM(CASE WHEN a.name = ${`fund:${fundId}:bank`} THEN e.amount ELSE 0 END), 0)::text AS bank,
      COALESCE(-SUM(CASE WHEN a.name = ${`fund:${fundId}:donations`} THEN e.amount ELSE 0 END), 0)::text AS donations,
      COALESCE((SELECT SUM(h.amount) FROM konto_holds h JOIN konto_accounts ha ON ha.id = h.account_id
        WHERE ha.name = ${`fund:${fundId}:bank`} AND h.status = 'PENDING'), 0)::text AS pending
    FROM konto_entries e JOIN konto_accounts a ON a.id = e.account_id
    WHERE a.name IN (${`fund:${fundId}:bank`}, ${`fund:${fundId}:donations`})
  `;
  const finalRow = expectedTotals[0];
  if (
    !finalRow ||
    balances.bankPaise !== BigInt(finalRow.bank) ||
    balances.donationsPaise !== BigInt(finalRow.donations) ||
    balances.pendingSpendPaise !== BigInt(finalRow.pending) ||
    balances.bankPaise !== expectedBank ||
    balances.donationsPaise !== expectedBank ||
    balances.pendingSpendPaise !== expectedPending ||
    balances.availablePaise !== balances.bankPaise - balances.pendingSpendPaise ||
    balances.bankPaise !== balances.donationsPaise
  ) {
    violations += 1;
    throw new Error(
      `Final balance invariant failed: ${JSON.stringify({ ...balances, bank: finalRow?.bank, donations: finalRow?.donations, pending: finalRow?.pending }, (_, value) => (typeof value === "bigint" ? value.toString() : value))}`,
    );
  }
  const duration = (performance.now() - started) / 1000;
  process.stdout.write(
    `result ops=${completed} seed=${seed} donations=${totalDonations} holds=${totalHolds} duration=${duration.toFixed(2)}s ops_per_sec=${(completed / duration).toFixed(2)} violations=${violations}\n`,
  );
} catch (error) {
  const duration = (performance.now() - started) / 1000;
  process.stderr.write(
    `failed ops=${completed} seed=${seed} duration=${duration.toFixed(2)}s ops_per_sec=${(completed / Math.max(duration, 0.001)).toFixed(2)} violations=${violations}\n`,
  );
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
