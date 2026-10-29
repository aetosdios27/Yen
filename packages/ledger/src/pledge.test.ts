import { chainHead, checkChainStructure, verifyChain } from "@yen/eventlog";
import { paise, parseFundId } from "@yen/shared";
import { expect, it } from "vitest";
import { getFundEvents } from "./eventlog.js";
import { available, getBalances, pledgeDonation, recordDonation } from "./operations.js";
import { replayFundEvents } from "./replay.js";
import { createTestFund, ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("donation pledges", (sql) => {
  it("keeps a self-reported pledge out of the spendable balance", async () => {
    const fundId = await createTestFund(sql);

    const result = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId, amount: paise(50000), utr: "123456789012" }),
    );
    expect(result.kind).toBe("pledged");

    const balances = await getBalances(sql, fundId);
    expect(balances.bankPaise).toBe(0n);
    expect(balances.availablePaise).toBe(0n);
    expect(balances.donationsPaise).toBe(0n);
    expect(balances.pledgedPaise).toBe(50000n);
    expect(await available(sql, fundId)).toBe(0n);
    const storedChoice = await sql<{ donor_name_choice: string }[]>`
      SELECT donor_name_choice FROM donation_pledges WHERE fund_id = ${fundId}
    `;
    expect(storedChoice[0]?.donor_name_choice).toBe("initials");
  });

  it("rejects a repeated UPI reference, including against another fund", async () => {
    const first = await createTestFund(sql);
    const second = await createTestFund(sql);

    await sql.begin((tx) =>
      pledgeDonation(tx, { fundId: first, amount: paise(10000), utr: "210987654321" }),
    );

    const repeated = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId: first, amount: paise(10000), utr: "210987654321" }),
    );
    expect(repeated).toEqual({ kind: "duplicate_utr" });

    const otherFund = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId: second, amount: paise(10000), utr: "210987654321" }),
    );
    expect(otherFund).toEqual({ kind: "duplicate_utr" });

    expect((await getBalances(sql, first)).pledgedPaise).toBe(10000n);
    expect((await getBalances(sql, second)).pledgedPaise).toBe(0n);
  });

  it("appends one chained pledge event, never a verification", async () => {
    const fundId = await createTestFund(sql);

    const result = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId, amount: paise(25000), utr: "111222333444" }),
    );
    if (result.kind !== "pledged") throw new Error("expected the pledge to be recorded");

    const events = await getFundEvents(sql, fundId);
    expect(events.map((event) => event.type)).toEqual(["donation.pledged"]);
    expect(events[0]?.payload).toEqual({
      donation_id: result.donationId,
      amount_paise: 25000,
    });
    expect(events[0]?.hash).toBe(result.event.hash);
    expect(events[0]?.prev_hash).toBe("0".repeat(64));

    const structure = await checkChainStructure(events);
    expect(structure.status).toBe("structure-consistent");

    const parsed = parseFundId(fundId);
    if (!parsed.ok) throw new Error("invalid fund id");
    const head = chainHead({
      fundId: parsed.value,
      count: events.length,
      latestHash: result.event.hash,
    });
    expect((await verifyChain(events, head)).ok).toBe(true);
  });

  it("never writes the donor's name, phone or UPI reference into the event log", async () => {
    const fundId = await createTestFund(sql);

    await sql.begin((tx) =>
      pledgeDonation(tx, {
        fundId,
        amount: paise(15000),
        utr: "555666777888",
        donorDisplayName: "Asha Rao",
        donorContact: "+919876543210",
        donorNameChoice: "full",
      }),
    );

    const rows = await sql<{ payload: unknown; canonical_envelope: string }[]>`
      SELECT payload, canonical_envelope FROM fund_events WHERE fund_id = ${fundId}
    `;
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("Asha");
    expect(stored).not.toContain("9876543210");
    expect(stored).not.toContain("555666777888");

    const pledge = await sql<
      {
        donor_contact: string | null;
        donor_name_choice: string;
        utr: string;
      }[]
    >`
      SELECT donor_contact, donor_name_choice, utr FROM donation_pledges WHERE fund_id = ${fundId}
    `;
    expect(pledge).toEqual([
      { donor_contact: "+919876543210", donor_name_choice: "full", utr: "555666777888" },
    ]);
  });

  it("replays to the same balances the ledger holds", async () => {
    const fundId = await createTestFund(sql);

    await sql.begin(async (tx) => {
      await pledgeDonation(tx, { fundId, amount: paise(40000), utr: "999888777666" });
      await recordDonation(tx, { fundId, amount: paise(70000), reference: "bank-credit-1" });
    });

    const events = await getFundEvents(sql, fundId);
    expect(replayFundEvents(fundId, events)).toEqual(await getBalances(sql, fundId));

    const balances = await getBalances(sql, fundId);
    expect(balances.availablePaise).toBe(70000n);
    expect(balances.pledgedPaise).toBe(40000n);
  });
});
