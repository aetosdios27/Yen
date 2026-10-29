import { buildIntervalTree, type FundId, fromHex, hash32, salt32, toHex } from "@yen/shared";
import type { SqlClient } from "./client.js";

/** Export one persisted, anchored fund interval in the standalone v1 wire format. */
export async function exportAuditBundle(
  client: SqlClient,
  fundId: FundId,
  anchorId: string,
  contractAddress: string,
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress))
    throw new Error("invalid expected registry address");
  const anchors = await client`
    SELECT id, from_seq, to_seq, root, chain_id, chain_sequence, tx_hash
    FROM anchors WHERE id = ${anchorId} AND fund_id = ${fundId} AND status IN ('submitted', 'confirmed')
  `;
  const anchor = anchors[0] as
    | {
        id: string;
        from_seq: number | string;
        to_seq: number | string;
        root: string;
        chain_id: number | string;
        chain_sequence: number | string;
        tx_hash: string | null;
      }
    | undefined;
  if (!anchor?.tx_hash)
    throw new Error("a submitted or confirmed anchor with a transaction hash is required");
  const fromSeq = Number(anchor.from_seq);
  const toSeq = Number(anchor.to_seq);
  const rows = await client`
    SELECT fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events WHERE fund_id = ${fundId} AND seq BETWEEN ${fromSeq} AND ${toSeq} ORDER BY seq
  `;
  const eventCount = Number(
    await client`SELECT count(*)::int AS count FROM fund_events WHERE fund_id = ${fundId}`.then(
      (result) => result[0]?.count ?? 0,
    ),
  );
  if (toSeq !== eventCount)
    throw new Error("current anchor interval must end at the persisted fund head");
  const salts = await client`
    SELECT seq, salt FROM anchor_event_salts WHERE anchor_id = ${anchorId} AND fund_id = ${fundId} ORDER BY seq
  `;
  if (rows.length !== toSeq - fromSeq + 1 || salts.length !== rows.length)
    throw new Error("anchor interval events or salts are incomplete");
  const events = rows.map((row) => ({
    fund_id: String(row.fund_id),
    seq: Number(row.seq),
    type: String(row.type),
    version: Number(row.version),
    actor: String(row.actor),
    occurred_at: String(row.occurred_at),
    payload: row.payload as Record<string, unknown>,
    prev_hash: String(row.prev_hash),
    hash: String(row.hash),
  }));
  const saltBySeq = new Map(salts.map((row) => [Number(row.seq), String(row.salt)]));
  const intervalEvents = events.map((event) => {
    const salt = saltBySeq.get(event.seq);
    if (!salt) throw new Error(`missing salt for event ${event.seq}`);
    return { seq: event.seq, eventHash: hash32(fromHex(event.hash)), salt: salt32(fromHex(salt)) };
  });
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error("anchor interval has no events");
  const tree = await buildIntervalTree([
    {
      fundId,
      latestEventHash: hash32(fromHex(lastEvent.hash)),
      events: intervalEvents,
    },
  ]);
  const proofs = await Promise.all(events.map((event) => tree.prove(fundId, event.seq)));
  const eventRootValue = tree.fundRoots[0];
  if (!eventRootValue) throw new Error("interval tree has no fund root");
  const eventRoot = toHex(eventRootValue);
  if (toHex(tree.root) !== anchor.root)
    throw new Error("stored anchor root does not match persisted events and salts");
  const checkpointRows =
    fromSeq === 1
      ? []
      : await client`
    SELECT hash FROM fund_events WHERE fund_id = ${fundId} AND seq = ${fromSeq - 1}
  `;
  const startHash =
    fromSeq === 1
      ? "0".repeat(64)
      : String((checkpointRows[0] as { hash: string } | undefined)?.hash ?? "");
  if (!/^[0-9a-f]{64}$/.test(startHash)) throw new Error("preceding event checkpoint is missing");
  return {
    format: "yen/audit-bundle/v1" as const,
    fund_id: fundId,
    chain: { start_seq: fromSeq - 1, start_hash: startHash },
    events: events.map((event, index) => {
      const proof = proofs[index];
      const salt = saltBySeq.get(event.seq);
      if (!proof || !salt) throw new Error(`proof or salt missing for event ${event.seq}`);
      return {
        event,
        salt,
        latest_event_hash: toHex(proof.latestEventHash),
        eventProof: { ...proof.eventProof, path: proof.eventProof.path.map(toHex) },
        fundProof: { ...proof.fundProof, path: proof.fundProof.path.map(toHex) },
      };
    }),
    roots: [
      {
        start_seq: fromSeq,
        end_seq: toSeq,
        event_root: eventRoot,
        fund_count: 1,
        global_root: toHex(tree.root),
      },
    ],
    anchor: {
      chain_id: Number(anchor.chain_id),
      contract_address: contractAddress,
      tx_hash: anchor.tx_hash,
      root: anchor.root,
      sequence: Number(anchor.chain_sequence),
    },
  };
}
