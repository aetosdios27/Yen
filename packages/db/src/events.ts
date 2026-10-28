import {
  type ChainHead,
  type ChainStructureCheck,
  type ChainVerification,
  canonicalize,
  checkChainStructureStream,
  type Event,
  type EventInput,
  makeNextEvent,
  parseEvent,
  verifyChainStream,
} from "@yen/eventlog";
import type { FundId } from "@yen/shared";
import { isSql, type SqlClient } from "./client.ts";

export type StoredFundEvent = Event & {
  readonly canonical_envelope: string;
};

type EventPayload<T extends Event["type"]> = (Event & { type: T })["payload"];

export type AppendEventInput =
  | {
      [K in Event["type"]]: {
        fundId: FundId;
        type: K;
        version: 1;
        actor: Event["actor"];
        occurredAt: string;
        payload: EventPayload<K>;
      };
    }[Event["type"]]
  | EventInput;

function toEventInput(input: AppendEventInput): EventInput {
  if ("fund_id" in input) {
    return input;
  }
  switch (input.type) {
    case "fund.created":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "fund.policy_changed":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "fund.visibility_changed":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "member.added":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "member.removed":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "donation.pledged":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "donation.verified":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "donation.rejected":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.submitted":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.evidence_added":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.flagged":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.objection_raised":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.objection_resolved":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.approved":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.rejected":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.expired":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.paid":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "expense.reversed":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "bank.credit_seen":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "bank.debit_seen":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "bank.balance_checked":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "discrepancy.raised":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "discrepancy.resolved":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
    case "anchor.published":
      return {
        fund_id: input.fundId,
        type: input.type,
        version: 1,
        actor: input.actor,
        occurred_at: input.occurredAt,
        payload: input.payload,
      };
  }
}

async function executeAppend(client: SqlClient, input: AppendEventInput): Promise<StoredFundEvent> {
  const eventInput = toEventInput(input);
  const fundId = eventInput.fund_id;

  // Acquire transaction-scoped advisory lock on fund ID to serialize appends
  await client`SELECT pg_advisory_xact_lock(yen_fund_lock_key(${fundId}::uuid))`;

  // Read current head event for this fund
  const rows = await client`
    SELECT fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
    FROM fund_events
    WHERE fund_id = ${fundId}
    ORDER BY seq DESC
    LIMIT 1
  `;

  let prevEvent: Event | null = null;
  const headRow = rows[0];
  if (headRow !== undefined) {
    const parsedHead = parseEvent({
      fund_id: headRow.fund_id,
      seq: Number(headRow.seq),
      type: headRow.type,
      version: headRow.version,
      actor: headRow.actor,
      occurred_at: headRow.occurred_at,
      payload: headRow.payload,
      prev_hash: headRow.prev_hash,
      hash: headRow.hash,
    });
    if (!parsedHead.ok) {
      throw new TypeError(`Current stored head event is invalid: ${parsedHead.error}`);
    }
    prevEvent = parsedHead.value;
  }

  // Construct next chained event
  const nextEvent = await makeNextEvent(prevEvent, eventInput);

  // Compute canonical envelope (RFC 8785 canonical JSON of the 8 unsigned fields)
  const { hash: _hash, ...unsignedEnvelope } = nextEvent;
  const canonicalEnvelope = canonicalize(unsignedEnvelope);

  // Insert into fund_events
  const inserted = await client`
    INSERT INTO fund_events (
      fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
    ) VALUES (
      ${nextEvent.fund_id},
      ${nextEvent.seq},
      ${nextEvent.type},
      ${nextEvent.version},
      ${nextEvent.actor},
      ${nextEvent.occurred_at},
      ${client.json(nextEvent.payload)},
      ${nextEvent.prev_hash},
      ${nextEvent.hash},
      ${canonicalEnvelope}
    )
    RETURNING fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
  `;

  const storedRow = inserted[0];
  if (storedRow === undefined) {
    throw new Error("Insert returned no row");
  }

  const parsedStored = parseEvent({
    fund_id: storedRow.fund_id,
    seq: Number(storedRow.seq),
    type: storedRow.type,
    version: storedRow.version,
    actor: storedRow.actor,
    occurred_at: storedRow.occurred_at,
    payload: storedRow.payload,
    prev_hash: storedRow.prev_hash,
    hash: storedRow.hash,
  });

  if (!parsedStored.ok) {
    throw new TypeError(`Inserted event failed parsing: ${parsedStored.error}`);
  }

  return {
    ...parsedStored.value,
    canonical_envelope: storedRow.canonical_envelope,
  };
}

/**
 * Append an event to a fund's event log.
 *
 * This is the ONLY authorized write path for fund events.
 * It must be called inside the caller's transaction. It acquires a
 * transaction-scoped advisory lock keyed on the fund ID, reads the current
 * head event, builds the next chained event using `makeNextEvent`, inserts the
 * row, and returns the stored event.
 */
export async function appendEvent(
  client: SqlClient,
  input: AppendEventInput,
): Promise<StoredFundEvent> {
  if (isSql(client)) {
    return client.begin((tx) => executeAppend(tx, input));
  }
  return executeAppend(client, input);
}

/**
 * Stream fund events ordered by seq ASC.
 */
export async function* streamFundEvents(client: SqlClient, fundId: FundId): AsyncIterable<unknown> {
  const cursor = client`
    SELECT fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events
    WHERE fund_id = ${fundId}
    ORDER BY seq ASC
  `.cursor(100);

  for await (const batch of cursor) {
    for (const row of batch) {
      yield {
        ...row,
        seq: Number(row.seq),
      };
    }
  }
}

/**
 * Verify a stored fund event chain against a caller-supplied authenticated ChainHead.
 */
export async function verifyStoredChain(
  client: SqlClient,
  fundId: FundId,
  expectedHead: ChainHead,
): Promise<ChainVerification> {
  return verifyChainStream(streamFundEvents(client, fundId), expectedHead);
}

/**
 * Check the structural consistency of a stored chain without an external head.
 * NOTE: This is a consistency check only, not an authenticity proof.
 */
export async function checkStoredChainStructure(
  client: SqlClient,
  fundId: FundId,
): Promise<ChainStructureCheck> {
  return checkChainStructureStream(streamFundEvents(client, fundId));
}
