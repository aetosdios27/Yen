import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createSql, uuidv7 } from "@yen/db";
import { getFundEvents, recordDonation, reserveForExpense, settleExpense } from "@yen/ledger";
import { buildIntervalTree, hash32, paise, parseFundId, salt32, toHex } from "@yen/shared";
import { captureRestoreManifest } from "../dist/restore.js";
import { initLedgerSchema } from "../dist/schema.js";

const sql = createSql(process.env.DATABASE_URL);
try {
  await initLedgerSchema(sql);
  const user = uuidv7(),
    org = uuidv7();
  await sql`INSERT INTO users (id, phone, display_name) VALUES (${user}, '+19999999999', 'Backup drill')`;
  await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${org}, 'Backup drill', 'individual', ${user})`;
  for (let index = 0; index < 4; index++) {
    const fund = uuidv7();
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fund}, ${org}, 'Backup drill', '{}')`;
    if (index === 3) continue;
    for (let donation = 0; donation < 25; donation++) {
      await sql.begin((tx) =>
        recordDonation(tx, { fundId: fund, amount: paise(12345 + donation) }),
      );
    }
    const hold = await sql.begin((tx) =>
      reserveForExpense(tx, { fundId: fund, amount: paise(1000) }),
    );
    await sql.begin((tx) =>
      settleExpense(tx, { fundId: fund, holdId: hold.holdId, expenseId: hold.expenseId }),
    );
    await sql.begin((tx) => reserveForExpense(tx, { fundId: fund, amount: paise(2000) }));
    const events = await getFundEvents(sql, fund);
    const parsed = parseFundId(fund);
    if (!parsed.ok) throw new Error("Invalid fixture fund");
    const leaves = events.map((event) => ({
      seq: event.seq,
      eventHash: hash32(Buffer.from(event.hash, "hex")),
      salt: salt32(randomBytes(32)),
    }));
    const tree = await buildIntervalTree([
      { fundId: parsed.value, latestEventHash: leaves.at(-1).eventHash, events: leaves },
    ]);
    const anchor = uuidv7();
    await sql`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, chain_id, chain_sequence)
      VALUES (${anchor}, ${fund}, 1, ${events.length}, ${toHex(tree.root)}, 80002, ${index + 1})`;
    for (const leaf of leaves) {
      await sql`INSERT INTO anchor_event_salts (anchor_id, fund_id, seq, salt) VALUES (${anchor}, ${fund}, ${leaf.seq}, ${toHex(leaf.salt)})`;
    }
  }
  const manifest = await captureRestoreManifest(sql);
  await writeFile(process.env.YEN_RESTORE_MANIFEST, JSON.stringify(manifest));
  console.log(
    `Source checkpoint captured: funds=${manifest.funds.length} anchors=${manifest.anchors.length}`,
  );
} finally {
  await sql.end();
}
