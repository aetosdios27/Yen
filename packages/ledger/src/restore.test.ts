import { uuidv7 } from "@yen/db";
import { buildIntervalTree, hash32, paise, parseFundId, salt32, toHex } from "@yen/shared";
import { expect, it } from "vitest";
import { getFundEvents } from "./eventlog.js";
import { recordDonation } from "./operations.js";
import { captureRestoreManifest, verifyRestoredDatabase } from "./restore.js";
import { createLedgerTestFund, ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("restore manifest", (sql) => {
  it("recomputes anchored roots and rejects missing salts", async () => {
    const fundId = await createLedgerTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(5000) }));
    const events = await getFundEvents(sql, fundId);
    const fund = parseFundId(fundId);
    if (!fund.ok) throw new Error("Invalid fixture fund");
    const leaves = events.map((event) => ({
      seq: event.seq,
      eventHash: hash32(Buffer.from(event.hash, "hex")),
      salt: salt32(new Uint8Array(32)),
    }));
    const tail = leaves.at(-1);
    if (!tail) throw new Error("Missing fixture events");
    const tree = await buildIntervalTree([
      { fundId: fund.value, latestEventHash: tail.eventHash, events: leaves },
    ]);
    const id = uuidv7();
    await sql`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, chain_id, chain_sequence)
      VALUES (${id}, ${fundId}, 1, 2, ${toHex(tree.root)}, 80002, 1)`;
    const manifest = await captureRestoreManifest(sql);
    await expect(verifyRestoredDatabase(sql, manifest)).rejects.toThrow(
      "Incomplete restored anchor",
    );
    for (const leaf of leaves) {
      await sql`INSERT INTO anchor_event_salts (anchor_id, fund_id, seq, salt)
        VALUES (${id}, ${fundId}, ${leaf.seq}, ${toHex(leaf.salt)})`;
    }
    await expect(verifyRestoredDatabase(sql, manifest)).resolves.toEqual({ funds: 1, anchors: 1 });
    const bad = uuidv7();
    await sql`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, chain_id, chain_sequence)
      VALUES (${bad}, ${fundId}, 1, 1, ${"0".repeat(64)}, 80002, 2)`;
    await sql`INSERT INTO anchor_event_salts (anchor_id, fund_id, seq, salt)
      VALUES (${bad}, ${fundId}, 1, ${"0".repeat(64)})`;
    await expect(verifyRestoredDatabase(sql, await captureRestoreManifest(sql))).rejects.toThrow(
      "Restored anchor root mismatch",
    );
  });
});

ledgerDatabaseSuite("restore chain checkpoints", (sql) => {
  it("verifies every fund and rejects a changed checkpoint or missing fund", async () => {
    const first = await createLedgerTestFund(sql);
    const second = await createLedgerTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId: first, amount: paise(12345) }));
    await sql.begin((tx) => recordDonation(tx, { fundId: second, amount: paise(67890) }));
    const manifest = await captureRestoreManifest(sql);
    expect(manifest.funds).toHaveLength(2);
    await expect(verifyRestoredDatabase(sql, manifest)).resolves.toEqual({ funds: 2, anchors: 0 });
    await expect(
      verifyRestoredDatabase(sql, {
        ...manifest,
        funds: manifest.funds.map((fund) =>
          fund.id === second ? { ...fund, hash: "0".repeat(64) } : fund,
        ),
      }),
    ).rejects.toThrow("Restore manifest mismatch");
    await expect(
      verifyRestoredDatabase(sql, { ...manifest, funds: manifest.funds.slice(0, 1) }),
    ).rejects.toThrow("Restore manifest mismatch");
  });
});
