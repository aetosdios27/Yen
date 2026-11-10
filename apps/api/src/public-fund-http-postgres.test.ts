import { randomInt } from "node:crypto";
import { migrate, publicAnchoredItemsSql, uuidv7 } from "@yen/db";
import { pseudonymIdSchema } from "@yen/eventlog";
import { createDraftRequest, getBalances, recordRefund } from "@yen/ledger";
import { AnchoringWorker, type RootSigner, reconcileAnchors } from "@yen/queue";
import { paise } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import * as z from "zod";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { FakeChain } from "../../../packages/queue/src/test/fake-chain.js";
import { createApp } from "./app.js";
import { PostgresDonationPledgeStore } from "./donation-store.js";
import { PostgresExpenseStore } from "./expense-store.js";
import { PostgresFundStore } from "./fund-store.js";
import { PostgresPublicFundHeadStore, PostgresPublicFundReadStore } from "./public-fund-store.js";
import { PostgresReceiptStore } from "./receipt-store.js";
import { PostgresReconciliationStore } from "./reconciliation/postgres-store.js";

const signer = {
  getAccount: async () => {
    throw new Error("Fake chain does not sign");
  },
} satisfies RootSigner;
// Text-join baseline with the same pledge domain, independent of the optimized joins.
const originalAnchoredSql = `SELECT DISTINCT CASE WHEN e.type = 'donation.verified' THEN bt.id::text
        ELSE ex.id::text END AS id
      FROM fund_events e
      JOIN bank_transactions bt ON bt.id::text = e.payload->>'bank_transaction_id'
        AND bt.fund_id = e.fund_id
      LEFT JOIN expenses ex ON ex.fund_id = e.fund_id AND ex.status = 'reconciled'
        AND ex.expense_data->>'bankTransactionId' = bt.id::text
      JOIN anchors a ON a.fund_id = e.fund_id AND e.seq BETWEEN a.from_seq AND a.to_seq
      WHERE e.fund_id = $1 AND a.status = 'confirmed' AND a.tx_hash IS NOT NULL
        AND (
          (e.type = 'donation.verified' AND bt.type = 'credit'
            AND bt.reconciliation_status IN ('matched', 'manually_matched')
            AND bt.matched_pledge_id::text = e.payload->>'donation_id'
            AND EXISTS (SELECT 1 FROM donation_pledges dp
              WHERE dp.id = bt.matched_pledge_id AND dp.fund_id = bt.fund_id AND dp.status IN ('verified', 'refunded')))
          OR (e.type = 'bank.debit_seen' AND bt.type = 'debit' AND ex.id IS NOT NULL
            AND ex.expense_data->>'amountPaise' = bt.amount_paise::text)
        );
`;

const alerts = { emit: async () => {} };
let utrCounter = 800_000_000_000;

databaseSuite("public HTTP financial proof with Postgres stores", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
  });

  async function fixture() {
    const userId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    await sql`INSERT INTO users (id,phone,display_name) VALUES (${userId}, ${`+91${randomInt(1_000_000_000, 10_000_000_000)}`}, 'Owner')`;
    await sql`INSERT INTO orgs (id,name,legal_form,owner_id) VALUES (${orgId},'Community','society',${userId})`;
    await sql`INSERT INTO funds (id,org_id,title,visibility_tier,policy_json) VALUES (${fundId},${orgId},'Community','public','{}')`;
    const expenses = new PostgresExpenseStore(sql);
    const pledges = new PostgresDonationPledgeStore(sql);
    const bank = new PostgresReconciliationStore(sql, alerts);
    const app = createApp({
      principal: null,
      sql,
      receiptStore: new PostgresReceiptStore(sql),
      fundStore: new PostgresFundStore(sql),
      expenseStore: expenses,
      donationPledgeStore: pledges,
      publicFundReadStore: new PostgresPublicFundReadStore(sql),
      publicFundHead: new PostgresPublicFundHeadStore(sql).get.bind(
        new PostgresPublicFundHeadStore(sql),
      ),
      reconciliationStore: bank,
    });
    async function comparePlans() {
      const original = await sql.unsafe<{ id: string }[]>(originalAnchoredSql, [fundId]);
      const optimized = await sql.unsafe<{ id: string }[]>(publicAnchoredItemsSql, [fundId]);
      expect(optimized.map((row) => row.id).sort()).toEqual(original.map((row) => row.id).sort());
    }
    async function read(route: "summary" | "timeline" | "breakdown") {
      await comparePlans();
      const response = await app.request(`/v1/funds/${fundId}/public/${route}`, {
        headers: { "cache-control": "no-cache" },
      });
      expect(response.status).toBe(200);
      return response;
    }
    async function totals() {
      const balances = await getBalances(sql, fundId);
      const body = await (await read("summary")).json();
      expect(body).toMatchObject({
        raisedPaise: String(balances.donationsPaise),
        pledgedPaise: String(balances.pledgedPaise),
        spentPaise: String(balances.expensesPaise),
      });
      return body;
    }
    async function pledge(amount = 5000) {
      const utr = String(utrCounter++);
      const result = await pledges.pledge({
        fundId,
        amountPaise: amount,
        utr,
        donorName: "Secret Donor Name",
        donorNameChoice: "anonymous",
        donorContact: "+919111222333",
      });
      if (result.kind !== "pledged") throw new Error("Expected new pledge");
      return { ...result, utr };
    }
    async function credit(utr: string, amount = 5000) {
      const result = await bank.ingest([
        {
          fundId,
          bankReference: uuidv7(),
          utr,
          amountPaise: paise(amount),
          type: "credit",
          postedAt: new Date().toISOString(),
          counterpartyVpa: "secret@bank",
          counterpartyName: "Secret Donor Name",
          source: "statement_upload",
          rawPayload: { account: "9876543210012345" },
        },
      ]);
      expect(result.matchedCount).toBe(1);
      const id = result.transactions[0]?.id;
      if (!id) throw new Error("Missing credit");
      return id;
    }
    async function state(id: string) {
      const body = z
        .object({ items: z.array(z.object({ id: z.string(), verified: z.string() })) })
        .parse(await (await read("timeline")).json());
      return body.items.find((item: { id: string }) => item.id === id)?.verified;
    }
    return { fundId, app, expenses, bank, read, totals, pledge, credit, state };
  }

  it("proves HTTP totals against ledger balances before and after statement reconciliation, isolated by fund", async () => {
    const f = await fixture();
    const other = await fixture();
    await other.pledge(9999);
    const pledge = await f.pledge();
    expect(await f.totals()).toMatchObject({
      raisedPaise: "0",
      pledgedPaise: "5000",
      verification: "unverified",
    });
    await f.credit(pledge.utr);
    expect(await f.totals()).toMatchObject({
      raisedPaise: "5000",
      pledgedPaise: "0",
      verification: "bank-matched",
    });
  });

  it("validates public pages from the event log head", async () => {
    const f = await fixture();
    await f.pledge();
    const head = (
      await sql`SELECT hash FROM fund_events WHERE fund_id = ${f.fundId} ORDER BY seq DESC LIMIT 1`
    )[0]?.hash;
    const orgId = (await sql`SELECT org_id FROM funds WHERE id = ${f.fundId}`)[0]?.org_id;
    expect(head).toBeDefined();
    expect(orgId).toBeDefined();

    const first = await f.app.request(`/v1/funds/${f.fundId}/public/summary`);
    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe(`W/"${f.fundId}-${head}"`);
    expect(first.headers.get("cache-tag")).toBe(`fund-${f.fundId}, org-${orgId}`);
    expect(first.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
    );

    const second = await f.app.request(`/v1/funds/${f.fundId}/public/summary`, {
      headers: { "if-none-match": first.headers.get("etag") ?? "" },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(`W/"${f.fundId}-${head}"`);
  });

  it("retains both refund movements and a truthful receipt while HTTP totals equal the ledger", async () => {
    const f = await fixture();
    const donation = await f.pledge();
    const creditId = await f.credit(donation.utr);
    const chain = new FakeChain();
    const worker = new AnchoringWorker(sql, chain, signer, alerts);
    await worker.runFund(f.fundId);
    chain.blockNumber = 112n;
    await worker.runFund(f.fundId);
    await reconcileAnchors(sql, chain, alerts);
    expect(await f.state(creditId)).toBe("anchored");
    await sql`UPDATE bank_transactions SET reconciliation_status = 'manually_matched' WHERE id = ${creditId}`;
    await f.totals();
    await sql.begin((tx) =>
      recordRefund(tx, { fundId: f.fundId, donationId: donation.donationId, reason: "cancelled" }),
    );
    expect(await f.totals()).toMatchObject({ raisedPaise: "0", pledgedPaise: "0" });
    const timeline = z
      .object({
        items: z.array(
          z.object({
            id: z.string(),
            itemType: z.string().optional(),
            amountPaise: z.string().optional(),
            verified: z.string(),
          }),
        ),
      })
      .parse(await (await f.read("timeline")).json());
    expect(timeline.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: creditId, amountPaise: "5000" }),
        expect.objectContaining({
          itemType: "refund",
          amountPaise: "5000",
          verified: "bank-matched",
        }),
      ]),
    );
    const receipt = await f.app.request(`/v1/receipts/${donation.donationId}`);
    expect(await receipt.json()).toMatchObject({
      status: "refunded",
      refundedAt: expect.any(String),
    });
    await expect(
      sql.begin((tx) => recordRefund(tx, { fundId: f.fundId, donationId: donation.donationId })),
    ).rejects.toThrow();
    const pending = await f.pledge(7000);
    await expect(
      sql.begin((tx) => recordRefund(tx, { fundId: f.fundId, donationId: pending.donationId })),
    ).rejects.toThrow();
    const unmatched = await f.bank.ingest([
      {
        fundId: f.fundId,
        bankReference: uuidv7(),
        amountPaise: paise(5000),
        type: "credit",
        postedAt: new Date().toISOString(),
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    const candidates = await f.bank.getUnmatchedCredits(f.fundId);
    expect(JSON.stringify(candidates)).not.toContain(donation.donationId);
    expect(unmatched.matchedCount).toBe(0);
    expect(
      await f.bank.manualMatch({
        fundId: f.fundId,
        pledgeId: pending.donationId,
        bankTransactionId: creditId,
        reason: "Try reused bank credit",
      }),
    ).toMatchObject({ kind: "already_matched" });
    expect(await f.totals()).toMatchObject({ verification: "bank-matched" });
    await worker.runFund(f.fundId);
    chain.blockNumber = 224n;
    await worker.runFund(f.fundId);
    await reconcileAnchors(sql, chain, alerts);
    const anchored = z
      .object({
        items: z.array(z.object({ itemType: z.string().optional(), verified: z.string() })),
      })
      .parse(await (await f.read("timeline")).json());
    expect(anchored.items.find((item) => item.itemType === "refund")?.verified).toBe("anchored");
    expect(await f.totals()).toMatchObject({ verification: "anchored" });
    const proof = await f.app.request(
      `/v1/funds/${f.fundId}/records/${timeline.items.find((item) => item.itemType === "refund")?.id}/proof`,
    );
    expect(proof.status).toBe(200);
    expect(await proof.json()).toMatchObject({ event: { type: "donation.rejected" } });
    const bytes = JSON.stringify(timeline);
    for (const secret of [
      "Secret Donor Name",
      "secret@bank",
      "+919111222333",
      "9876543210012345",
      donation.utr,
    ])
      expect(bytes).not.toContain(secret);
  });

  it("does not borrow another fund's anchor or an earlier interval for a newly matched donation", async () => {
    const other = await fixture();
    const otherPledge = await other.pledge();
    await other.credit(otherPledge.utr);
    const chain = new FakeChain();
    const otherWorker = new AnchoringWorker(sql, chain, signer, alerts);
    await otherWorker.runFund(other.fundId);
    chain.blockNumber = 112n;
    await otherWorker.runFund(other.fundId);
    const f = await fixture();
    const donation = await f.pledge();
    const worker = new AnchoringWorker(sql, chain, signer, alerts);
    await worker.runFund(f.fundId);
    await worker.runFund(f.fundId);
    const id = await f.credit(donation.utr);
    expect(await f.state(id)).toBe("bank-matched");
    expect(await f.totals()).toMatchObject({ verification: "bank-matched" });
  });

  it("refuses a confirmed anchor without a transaction hash, and a cross-fund pledge link", async () => {
    const f = await fixture();
    const donation = await f.pledge();
    const id = await f.credit(donation.utr);
    const chain = new FakeChain();
    chain.crashAfterFirstBroadcast = true;
    const worker = new AnchoringWorker(sql, chain, signer, alerts);
    await expect(worker.runFund(f.fundId)).rejects.toThrow("simulated process kill");
    expect(await f.state(id)).toBe("bank-matched");
    // Fault injection: a damaged status row must not claim a public proof.
    await sql`UPDATE anchors SET status = 'submitted' WHERE fund_id = ${f.fundId}`;
    await sql`UPDATE anchors SET status = 'confirmed' WHERE fund_id = ${f.fundId}`;
    expect(await f.state(id)).toBe("bank-matched");
    const other = await fixture();
    const otherDonation = await other.pledge();
    await other.credit(otherDonation.utr);
    await sql`UPDATE bank_transactions SET matched_pledge_id = ${otherDonation.donationId} WHERE id = ${id}`;
    expect(await f.state(id)).toBeUndefined();
    expect(await (await f.read("summary")).json()).toMatchObject({
      raisedPaise: "0",
      verification: "unverified",
    });
  });

  it("proves donation and expense states through approval, debit matching and worker confirmation; public bytes redact private data", async () => {
    const f = await fixture();
    const pledge = await f.pledge();
    const creditId = await f.credit(pledge.utr);
    expect(await f.state(creditId)).toBe("bank-matched");
    const chain = new FakeChain();
    const worker = new AnchoringWorker(sql, chain, signer, alerts);
    await worker.runFund(f.fundId);
    expect(await f.state(creditId)).toBe("bank-matched");
    chain.blockNumber = 112n;
    await worker.runFund(f.fundId);
    await reconcileAnchors(sql, chain, alerts);
    expect(await f.state(creditId)).toBe("anchored");
    expect(await f.totals()).toMatchObject({ verification: "anchored" });

    const policy = { approvalQuorum: 1, objectionWindowHours: 0, autoExpireHours: 0 };
    const draft = createDraftRequest({
      fundId: f.fundId,
      requesterId: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
      amountPaise: paise(500),
      description: "Private account 9876543210012345",
      recipientRef: "supplier@bank",
      evidence: [{ evidenceId: uuidv7(), contentSha256: "a".repeat(64) }],
    });
    await f.expenses.save(draft);
    await f.expenses.save({ ...draft, status: "submitted" }, { policy });
    await f.expenses.atomicApprove(
      draft.id,
      {
        approverId: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
        passkeySignature: {
          credentialId: "test",
          signatureHex: "00",
          clientDataJson: "{}",
          authenticatorDataHex: "00",
        },
        approvedAt: new Date().toISOString(),
      },
      policy,
      () => true,
      new Date().toISOString(),
    );
    const result = await f.bank.ingest([
      {
        fundId: f.fundId,
        bankReference: uuidv7(),
        amountPaise: paise(500),
        type: "debit",
        postedAt: new Date().toISOString(),
        counterpartyVpa: "supplier@bank",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    expect(result.matchedCount).toBe(1);
    const paid = await f.expenses.get(draft.id);
    if (!paid) throw new Error("Missing paid expense");
    expect(paid.status).toBe("paid");
    expect(await f.totals()).toMatchObject({ verification: "bank-matched" });
    await f.expenses.save({ ...paid, status: "reconciled" });
    expect(await f.state(draft.id)).toBe("unverified");
    expect(await f.totals()).toMatchObject({ verification: "bank-matched" });
    await worker.runFund(f.fundId);
    expect(await f.state(draft.id)).toBe("unverified");
    chain.blockNumber = 112n;
    await worker.runFund(f.fundId);
    await reconcileAnchors(sql, chain, alerts);
    expect(await f.state(draft.id)).toBe("anchored");
    expect(await f.totals()).toMatchObject({ verification: "anchored" });
    // Fault injection after a real reconciliation: neither a mismatched amount nor
    // a status-only expense without its own debit event can inherit that proof.
    const reconciled = await f.expenses.get(draft.id);
    if (!reconciled) throw new Error("Missing reconciled expense");
    await sql`UPDATE expenses SET expense_data = ${JSON.stringify({ ...reconciled, amountPaise: 501 })}::jsonb WHERE id = ${draft.id}`;
    expect(await f.state(draft.id)).toBe("unverified");
    for (const bad of [undefined, "", "not-a-uuid"]) {
      await sql`UPDATE expenses SET expense_data = ${JSON.stringify({ ...reconciled, bankTransactionId: bad })}::jsonb WHERE id = ${draft.id}`;
      expect(await f.state(draft.id)).toBe("unverified");
    }
    for (const bad of [undefined, "", "not-a-number"]) {
      await sql`UPDATE expenses SET expense_data = ${JSON.stringify({ ...reconciled, amountPaise: bad })}::jsonb WHERE id = ${draft.id}`;
      const response = await f.app.request(`/v1/funds/${f.fundId}/public/timeline`);
      expect(response.status).toBe(200);
    }
    await sql`UPDATE expenses SET expense_data = ${JSON.stringify(reconciled)}::jsonb WHERE id = ${draft.id}`;
    const noDebit = createDraftRequest({
      fundId: f.fundId,
      requesterId: draft.requesterId,
      amountPaise: paise(500),
      description: "No debit event",
      recipientRef: "supplier@bank",
    });
    await f.expenses.save(noDebit);
    await sql`UPDATE expenses SET status = 'reconciled', expense_data = ${JSON.stringify({ ...noDebit, status: "reconciled", bankTransactionId: paid.bankTransactionId })}::jsonb WHERE id = ${noDebit.id}`;
    expect(await f.state(noDebit.id)).toBe("unverified");
    await sql`INSERT INTO evidence_records (evidence_id,expense_id,file_sha256,file_size_bytes,content_type,file_name,storage_key,scan_result,scanner_name,signature_version,created_at)
      VALUES (${draft.evidence[0]?.evidenceId ?? uuidv7()},${draft.id},${"a".repeat(64)},100,'image/png','private.png','private/storage/secret-evidence','clean','test','v1',now())`;
    const bytes = (
      await Promise.all(
        ["summary", "timeline", "breakdown"].map(async (route) => {
          const response = await f.app.request(`/v1/funds/${f.fundId}/public/${route}`);
          expect(response.status).toBe(200);
          return response.text();
        }),
      )
    ).join("\n");
    for (const secret of [
      "+919111222333",
      pledge.utr,
      "secret@bank",
      "supplier@bank",
      "9876543210012345",
      "Secret Donor Name",
      "private/storage/secret-evidence",
    ]) {
      expect(bytes).not.toContain(secret);
    }
  });
});
