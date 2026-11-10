import type { Sql } from "@yen/db";
import { buildIntervalTree, hash32, parseFundId, salt32, toHex } from "@yen/shared";
import { z } from "zod";
import { verifyFundState } from "./chaos.js";

const hex = z.string().regex(/^[0-9a-f]{64}$/);
export const restoreManifestSchema = z.object({
  funds: z.array(
    z.object({ id: z.uuid(), count: z.number().int().nonnegative(), hash: hex.nullable() }),
  ),
  anchors: z.array(
    z.object({
      id: z.uuid(),
      fund_id: z.uuid(),
      from_seq: z.string(),
      to_seq: z.string(),
      root: hex,
    }),
  ),
});

export async function captureRestoreManifest(sql: Sql) {
  const funds = await sql`
    SELECT f.id, count(e.seq)::int AS count,
      (SELECT hash FROM fund_events WHERE fund_id = f.id ORDER BY seq DESC LIMIT 1) AS hash
    FROM funds f LEFT JOIN fund_events e ON e.fund_id = f.id GROUP BY f.id ORDER BY f.id
  `;
  const anchors = await sql`
    SELECT id, fund_id, from_seq::text, to_seq::text, root FROM anchors ORDER BY id
  `;
  return restoreManifestSchema.parse({ funds, anchors });
}

export async function verifyRestoredDatabase(sql: Sql, rawManifest: unknown) {
  const expected = restoreManifestSchema.parse(rawManifest);
  const actual = await captureRestoreManifest(sql);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Restore manifest mismatch: funds, chain heads or anchored roots changed");
  }
  for (const fund of expected.funds) await verifyFundState(sql, fund.id);
  for (const anchor of expected.anchors) {
    const fund = parseFundId(anchor.fund_id);
    if (!fund.ok) throw new Error("Invalid anchor fund");
    const rows = await sql<{ seq: string; hash: string; salt: string }[]>`
      SELECT e.seq::text, e.hash, s.salt FROM fund_events e
      JOIN anchor_event_salts s ON s.fund_id = e.fund_id AND s.seq = e.seq
      WHERE s.anchor_id = ${anchor.id} AND e.fund_id = ${anchor.fund_id}
        AND e.seq BETWEEN ${anchor.from_seq} AND ${anchor.to_seq} ORDER BY e.seq
    `;
    const tail = rows.at(-1);
    if (!tail || BigInt(rows.length) !== BigInt(anchor.to_seq) - BigInt(anchor.from_seq) + 1n) {
      throw new Error(`Incomplete restored anchor ${anchor.id}`);
    }
    const tree = await buildIntervalTree([
      {
        fundId: fund.value,
        latestEventHash: hash32(Buffer.from(tail.hash, "hex")),
        events: rows.map((row) => ({
          seq: Number(row.seq),
          eventHash: hash32(Buffer.from(row.hash, "hex")),
          salt: salt32(Buffer.from(row.salt, "hex")),
        })),
      },
    ]);
    if (toHex(tree.root) !== anchor.root)
      throw new Error(`Restored anchor root mismatch ${anchor.id}`);
  }
  return { funds: expected.funds.length, anchors: expected.anchors.length };
}
