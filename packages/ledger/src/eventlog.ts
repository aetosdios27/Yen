import type { KontoTransactionExecutor } from "@konto-ledger/types";
import { type Event, type EventInput, makeNextEvent, parseEvent } from "@yen/eventlog";

export function toEventInput(raw: {
  fund_id: string;
  type: string;
  actor: string;
  occurred_at: string;
  payload: unknown;
}): EventInput {
  const parsed = parseEvent({
    ...raw,
    seq: 1,
    version: 1,
    prev_hash: "0".repeat(64),
    hash: "0".repeat(64),
  });
  if (!parsed.ok) {
    throw new TypeError(`Invalid event input: ${parsed.error}`);
  }
  const { seq: _s, prev_hash: _p, hash: _h, ...input } = parsed.value;
  return input;
}

export function nowUtcIso(prevOccurredAt?: string): string {
  const nowMs = Date.now();
  const prevMs = prevOccurredAt ? Date.parse(prevOccurredAt) : 0;
  const targetMs = Math.max(nowMs, Number.isFinite(prevMs) ? prevMs + 1 : nowMs);
  return new Date(targetMs).toISOString();
}

interface FundEventRow {
  fund_id: string;
  seq: string | number;
  version: number;
  type: string;
  actor: string;
  occurred_at: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}

export function parseFundEventRow(row: FundEventRow): Event {
  const parsed = parseEvent({
    fund_id: row.fund_id,
    seq: Number(row.seq),
    version: 1,
    type: row.type,
    actor: row.actor,
    occurred_at: row.occurred_at,
    payload: row.payload,
    prev_hash: row.prev_hash,
    hash: row.hash,
  });
  if (!parsed.ok) {
    throw new TypeError(`Corrupt fund event in database: ${parsed.error}`);
  }
  return parsed.value;
}

export async function getLatestFundEvent(
  tx: KontoTransactionExecutor,
  fundId: string,
): Promise<Event | null> {
  const rows = await tx<FundEventRow[]>`
    SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events
    WHERE fund_id = ${fundId}
    ORDER BY seq DESC
    LIMIT 1
    FOR UPDATE
  `;
  const latest = rows[0];
  if (!latest) return null;
  return parseFundEventRow(latest);
}

export async function appendFundEventInTx(
  tx: KontoTransactionExecutor,
  fundId: string,
  input: EventInput,
): Promise<Event> {
  // Acquire transaction-scoped advisory lock keyed by fundId to serialize concurrent appends per fund
  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  const prev = await getLatestFundEvent(tx, fundId);
  const event = await makeNextEvent(prev, input);

  await tx`
    INSERT INTO fund_events (
      fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
    ) VALUES (
      ${event.fund_id},
      ${event.seq.toString()},
      ${event.version},
      ${event.type},
      ${event.actor},
      ${event.occurred_at},
      ${tx.json(event.payload)},
      ${event.prev_hash},
      ${event.hash}
    )
  `;

  return event;
}

export const appendEvent = appendFundEventInTx;

export async function getFundEvents(
  sql: KontoTransactionExecutor,
  fundId: string,
): Promise<Event[]> {
  const rows = await sql<FundEventRow[]>`
    SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events
    WHERE fund_id = ${fundId}
    ORDER BY seq ASC
  `;
  return rows.map(parseFundEventRow);
}
