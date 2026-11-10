import type { Sql } from "../client.js";

/** Plan-only cardinality fixture, deliberately independent of product correctness tests. */
export async function seedPublicFundPlanFixture(sql: Sql, fund: string): Promise<void> {
  await sql`INSERT INTO donation_pledges (id,fund_id,amount_paise,utr,status) SELECT md5('pledge'||g)::uuid, ${fund}::uuid, 100, lpad(g::text,12,'0'), CASE WHEN g <= 20000 THEN 'verified' ELSE 'pledged' END FROM generate_series(1,25000) g`;
  await sql`INSERT INTO bank_transactions (id,fund_id,bank_reference,amount_paise,type,posted_at,source,raw_payload,reconciliation_status,matched_pledge_id,matched_at,match_method) SELECT md5('bank'||g)::uuid,${fund}::uuid,'bank-'||g,100,'credit',now(),'statement_upload','{}','matched',md5('pledge'||g)::uuid,now(),'exact_utr' FROM generate_series(1,20000) g`;
  // Synthetic plan-only fixture: chain hashing is irrelevant to planner cardinality.
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE fund_events DISABLE TRIGGER fund_events_before_insert`;
    await tx`INSERT INTO fund_events (fund_id,seq,type,version,actor,occurred_at,payload,prev_hash,hash,canonical_envelope) SELECT ${fund}::uuid,g,CASE WHEN g <= 20000 THEN 'donation.verified' ELSE 'bank.credit_seen' END,1,'psn_00000000-0000-4000-8000-000000000001','2026-10-28T00:00:00.000Z',jsonb_build_object('bank_transaction_id',md5('bank'||g)::uuid,'donation_id',md5('pledge'||g)::uuid),repeat('0',64),repeat('a',64),'{}' FROM generate_series(1,50000) g`;
    await tx`ALTER TABLE fund_events ENABLE TRIGGER fund_events_before_insert`;
  });
  await sql`INSERT INTO anchors (id,fund_id,from_seq,to_seq,root,status,tx_hash,chain_id,chain_sequence) SELECT gen_random_uuid(),${fund}::uuid,(g-1)*10000+1,g*10000,repeat('a',64),'confirmed','0x'||repeat('b',64),80002,g FROM generate_series(1,5) g`;
  await sql`VACUUM ANALYZE donation_pledges`;
  await sql`ANALYZE`;
}
