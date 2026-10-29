import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalize,
  chainHead,
  computeEventHash,
  type Event,
  genesisHash,
  hashHexSchema,
  pseudonymIdSchema,
} from "@yen/eventlog";
import { type FundId, fundIdSchema, orgIdSchema, sha256, toHex, userIdSchema } from "@yen/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createSql, type Sql, type SqlClient } from "./client.js";
import { appendEvent, checkStoredChainStructure, verifyStoredChain } from "./events.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";
import { runVerifyCli } from "./verify-cli.js";

const vectorsDir = fileURLToPath(new URL("../../eventlog/test-vectors/", import.meta.url));

async function computeRawEnvelopeHash(canonical: string): Promise<string> {
  const domainBytes = new TextEncoder().encode("yen/eventlog/event/v1\u0000");
  const envelopeBytes = new TextEncoder().encode(canonical);
  return toHex(await sha256(domainBytes, envelopeBytes));
}

async function insertRawEnvelope(
  client: SqlClient,
  raw: {
    fundId: string;
    seq: number;
    type: string;
    version: number;
    actor: string;
    occurredAt: string;
    payload: unknown;
    prevHash: string;
  },
): Promise<string> {
  const unsigned = {
    actor: raw.actor,
    fund_id: raw.fundId,
    occurred_at: raw.occurredAt,
    payload: raw.payload,
    prev_hash: raw.prevHash,
    seq: raw.seq,
    type: raw.type,
    version: raw.version,
  };
  const canonical = canonicalize(unsigned);
  const hash = await computeRawEnvelopeHash(canonical);
  // Schema-qualified on purpose: the R1 test must reach the real table even when a
  // session-local TEMP table named fund_events exists.
  await client`
    INSERT INTO public.fund_events (
      fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
    ) VALUES (
      ${raw.fundId}, ${raw.seq}, ${raw.type}, ${raw.version}, ${raw.actor}, ${raw.occurredAt},
      ${client.json(raw.payload as Parameters<typeof client.json>[0])}, ${raw.prevHash}, ${hash}, ${canonical}
    )
  `;
  return hash;
}

async function createTestFund(
  sql: Sql,
  fundId: FundId = fundIdSchema.parse(uuidv7()),
): Promise<FundId> {
  const userId = userIdSchema.parse(uuidv7());
  const orgId = orgIdSchema.parse(uuidv7());
  const phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  await sql`
    INSERT INTO users (id, phone, display_name)
    VALUES (${userId}, ${phone}, 'Test User')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO orgs (id, name, legal_form, owner_id)
    VALUES (${orgId}, 'Test Org', 'society', ${userId})
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO funds (id, org_id, title, policy_json)
    VALUES (${fundId}, ${orgId}, 'Test Fund', '{}')
    ON CONFLICT DO NOTHING
  `;
  return fundId;
}

databaseSuite("fund_events persistence layer", (sql, url) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  describe("database-enforced immutability and non-superuser application role", () => {
    it("fails update, delete, and truncate when run as a non-superuser application role", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      // Append one event as superuser
      await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      // Create a non-superuser application role
      const roleName = `yen_app_test_${uuidv7().replaceAll("-", "")}`;
      const dbName = new URL(url).pathname.slice(1);
      await sql`CREATE ROLE ${sql(roleName)} WITH LOGIN PASSWORD 'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`;
      await sql`GRANT CONNECT ON DATABASE ${sql(dbName)} TO ${sql(roleName)}`;
      await sql`GRANT USAGE ON SCHEMA public TO ${sql(roleName)}`;
      await sql`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${sql(roleName)}`;

      const appUrl = new URL(url);
      appUrl.username = roleName;
      appUrl.password = "app_pw";
      const appSql = createSql(appUrl.toString());

      try {
        // App role can read
        const rows =
          await appSql`SELECT seq, type, hash FROM fund_events WHERE fund_id = ${fundId}`;
        expect(rows).toHaveLength(1);

        // App role UPDATE must fail (permission denied by revoke and/or trigger)
        await expect(
          appSql`UPDATE fund_events SET type = 'fund.policy_changed' WHERE fund_id = ${fundId}`,
        ).rejects.toThrow();

        // App role DELETE must fail
        await expect(appSql`DELETE FROM fund_events WHERE fund_id = ${fundId}`).rejects.toThrow();

        // App role TRUNCATE must fail
        await expect(appSql`TRUNCATE fund_events`).rejects.toThrow();

        // Even if permissions were granted to the app role, triggers forbid UPDATE/DELETE/TRUNCATE
        await sql`GRANT UPDATE, DELETE, TRUNCATE ON fund_events TO ${sql(roleName)}`;

        await expect(
          appSql`UPDATE fund_events SET type = 'fund.policy_changed' WHERE fund_id = ${fundId}`,
        ).rejects.toThrow(/fund_events is append-only: UPDATE is forbidden/);

        await expect(appSql`DELETE FROM fund_events WHERE fund_id = ${fundId}`).rejects.toThrow(
          /fund_events is append-only: DELETE is forbidden/,
        );

        await expect(appSql`TRUNCATE fund_events`).rejects.toThrow(
          /fund_events is append-only: TRUNCATE is forbidden/,
        );
      } finally {
        await appSql.end();
        await sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${sql(roleName)}`;
        await sql`REVOKE ALL ON SCHEMA public FROM ${sql(roleName)}`;
        await sql`REVOKE CONNECT ON DATABASE ${sql(dbName)} FROM ${sql(roleName)}`;
        await sql`DROP ROLE ${sql(roleName)}`;
      }
    });
  });

  describe("100 concurrent appends to one fund", () => {
    it("produces a gapless seq 1..100 with a chain that verifyStoredChain accepts", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      // 100 concurrent appends to ONE fund
      const promises = Array.from({ length: 100 }, () =>
        appendEvent(sql, {
          fundId,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt: "2026-01-01T00:00:00.000Z",
          payload: { org_id: orgId, visibility: "private" },
        }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);

      // Verify gapless seq 1..100 in database
      const rows = await sql`
        SELECT seq, prev_hash, hash
        FROM fund_events
        WHERE fund_id = ${fundId}
        ORDER BY seq ASC
      `;
      expect(rows).toHaveLength(100);
      for (let i = 0; i < 100; i++) {
        expect(Number(rows[i]?.seq)).toBe(i + 1);
        if (i === 0) {
          expect(rows[i]?.prev_hash).toBe(genesisHash);
        } else {
          expect(rows[i]?.prev_hash).toBe(rows[i - 1]?.hash);
        }
      }

      // Verify with verifyStoredChain
      const latestRow = rows[99];
      expect(latestRow).toBeDefined();
      if (!latestRow) {
        throw new Error("Missing 100th row");
      }
      const expectedHead = chainHead({
        fundId,
        count: 100,
        latestHash: hashHexSchema.parse(latestRow.hash),
      });

      const verification = await verifyStoredChain(sql, fundId, expectedHead);
      expect(verification).toEqual({
        ok: true,
        count: 100,
        latestHash: latestRow.hash,
        verifiedAgainst: expectedHead,
      });
    });

    it("concurrent appends to different funds do not block each other", async () => {
      const fundA = await createTestFund(sql);
      const fundB = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      const appends = [
        ...Array.from({ length: 10 }, () =>
          appendEvent(sql, {
            fundId: fundA,
            type: "fund.created",
            version: 1,
            actor,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload: { org_id: orgId, visibility: "private" },
          }),
        ),
        ...Array.from({ length: 10 }, () =>
          appendEvent(sql, {
            fundId: fundB,
            type: "fund.created",
            version: 1,
            actor,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload: { org_id: orgId, visibility: "public" },
          }),
        ),
      ];

      await expect(Promise.all(appends)).resolves.toHaveLength(20);

      const headA = await checkStoredChainStructure(sql, fundA);
      const headB = await checkStoredChainStructure(sql, fundB);
      expect(headA.status).toBe("structure-consistent");
      expect(headB.status).toBe("structure-consistent");
      if (headA.status === "structure-consistent" && headB.status === "structure-consistent") {
        expect(headA.observedHead.count).toBe(10);
        expect(headB.observedHead.count).toBe(10);
      }
    });
  });

  describe("direct SQL inserts skipping appendEvent are rejected by database triggers", () => {
    it("rejects wrong seq (gap)", async () => {
      const fundId = await createTestFund(sql);
      const actor = `psn_${uuidv7()}`;
      const payload = { org_id: uuidv7(), visibility: "private" };
      const canonical = `{"actor":"${actor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${payload.org_id}","visibility":"private"},"prev_hash":"${genesisHash}","seq":2,"type":"fund.created","version":1}`;
      const hash = "0".repeat(64);

      // seq = 2 on empty fund
      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 2, 'fund.created', 1, ${actor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payload)}, ${genesisHash}, ${hash}, ${canonical}
        )
      `).rejects.toThrow(/First event seq must be 1, got 2/);
    });

    it("rejects wrong prev_hash", async () => {
      const fundId = await createTestFund(sql);
      const actor = `psn_${uuidv7()}`;
      const payload = { org_id: uuidv7(), visibility: "private" };
      const wrongPrev = "f".repeat(64);
      const canonical = `{"actor":"${actor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${payload.org_id}","visibility":"private"},"prev_hash":"${wrongPrev}","seq":1,"type":"fund.created","version":1}`;

      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 1, 'fund.created', 1, ${actor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payload)}, ${wrongPrev}, ${"0".repeat(64)}, ${canonical}
        )
      `).rejects.toThrow(/First event prev_hash must be 64 zeroes/);
    });

    it("rejects wrong hash", async () => {
      const fundId = await createTestFund(sql);
      const actor = `psn_${uuidv7()}`;
      const orgId = uuidv7();
      const payload = { org_id: orgId, visibility: "private" };
      const canonical = `{"actor":"${actor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${orgId}","visibility":"private"},"prev_hash":"${genesisHash}","seq":1,"type":"fund.created","version":1}`;
      const wrongHash = "1".repeat(64);

      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 1, 'fund.created', 1, ${actor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payload)}, ${genesisHash}, ${wrongHash}, ${canonical}
        )
      `).rejects.toThrow(/Event hash mismatch/);
    });

    it("rejects non-canonical envelope (wrong key ordering or extra spaces)", async () => {
      const fundId = await createTestFund(sql);
      const actor = `psn_${uuidv7()}`;
      const orgId = uuidv7();
      const payload = { org_id: orgId, visibility: "private" };
      // Keys in non-canonical order (version first)
      const nonCanonical = `{"version":1,"actor":"${actor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${orgId}","visibility":"private"},"prev_hash":"${genesisHash}","seq":1,"type":"fund.created"}`;

      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 1, 'fund.created', 1, ${actor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payload)}, ${genesisHash}, ${"0".repeat(64)}, ${nonCanonical}
        )
      `).rejects.toThrow(/canonical_envelope is not RFC 8785 canonical JSON/);
    });

    it("rejects mismatched payload between column and canonical_envelope", async () => {
      const fundId = await createTestFund(sql);
      const actor = `psn_${uuidv7()}`;
      const orgId = uuidv7();
      const payloadColumn = { org_id: orgId, visibility: "private" };
      const canonical = `{"actor":"${actor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${orgId}","visibility":"public"},"prev_hash":"${genesisHash}","seq":1,"type":"fund.created","version":1}`;

      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 1, 'fund.created', 1, ${actor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payloadColumn)}, ${genesisHash}, ${"0".repeat(64)}, ${canonical}
        )
      `).rejects.toThrow(/payload column does not match payload inside canonical_envelope/);
    });

    it("rejects bad actor shape", async () => {
      const fundId = await createTestFund(sql);
      const badActor = uuidv7(); // Missing psn_ prefix
      const orgId = uuidv7();
      const payload = { org_id: orgId, visibility: "private" };
      const canonical = `{"actor":"${badActor}","fund_id":"${fundId}","occurred_at":"2026-01-01T00:00:00.000Z","payload":{"org_id":"${orgId}","visibility":"private"},"prev_hash":"${genesisHash}","seq":1,"type":"fund.created","version":1}`;

      await expect(sql`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fundId}, 1, 'fund.created', 1, ${badActor}, '2026-01-01T00:00:00.000Z',
          ${sql.json(payload)}, ${genesisHash}, ${"0".repeat(64)}, ${canonical}
        )
      `).rejects.toThrow(/Invalid actor pseudonym format|violates check constraint/);
    });

    it("rejects backward occurred_at (non-monotonic time)", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:05:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      // Try appending earlier time
      await expect(
        appendEvent(sql, {
          fundId,
          type: "fund.visibility_changed",
          version: 1,
          actor,
          occurredAt: "2026-01-01T00:04:00.000Z",
          payload: { visibility: "public" },
        }),
      ).rejects.toThrow(/Event time moved backwards/);
    });
  });

  describe("each insert-trigger guard rejects a row that is otherwise fully valid", () => {
    // These rows carry a correct canonical envelope and a correct hash, so the only thing
    // wrong with each is the one field under test. A guard that is removed from the trigger
    // makes the matching test fail instead of being masked by the hash check.
    type ForgedFields = {
      readonly fundId: FundId;
      readonly seq: number;
      readonly prevHash: string;
      readonly occurredAt: string;
    };
    const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);

    async function insertForged(client: SqlClient, fields: ForgedFields): Promise<string> {
      const payload = { visibility: "public" } as const;
      const unsigned = {
        fund_id: fields.fundId,
        seq: fields.seq,
        type: "fund.visibility_changed",
        version: 1,
        actor,
        occurred_at: fields.occurredAt,
        payload,
        prev_hash: hashHexSchema.parse(fields.prevHash),
      } as const;
      const hash = await computeEventHash(unsigned);
      await client`
        INSERT INTO fund_events (
          fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
        ) VALUES (
          ${fields.fundId}, ${fields.seq}, ${unsigned.type}, 1, ${actor}, ${fields.occurredAt},
          ${client.json(payload)}, ${fields.prevHash}, ${hash}, ${canonicalize(unsigned)}
        )
      `;
      return hash;
    }

    async function fundWithOneEvent(): Promise<{ fundId: FundId; head: Event }> {
      const fundId = await createTestFund(sql);
      const head = await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgIdSchema.parse(uuidv7()), visibility: "private" },
      });
      return { fundId, head };
    }

    it("rejects a seq gap on a later event", async () => {
      const { fundId, head } = await fundWithOneEvent();
      await expect(
        insertForged(sql, {
          fundId,
          seq: head.seq + 2,
          prevHash: head.hash,
          occurredAt: "2026-01-01T00:00:01.000Z",
        }),
      ).rejects.toThrow(/Event seq gap/);
    });

    it("rejects a prev_hash that does not match the previous event", async () => {
      const { fundId, head } = await fundWithOneEvent();
      await expect(
        insertForged(sql, {
          fundId,
          seq: head.seq + 1,
          prevHash: "f".repeat(64),
          occurredAt: "2026-01-01T00:00:01.000Z",
        }),
      ).rejects.toThrow(/Event prev_hash mismatch/);
    });

    it("rejects an event dated before its predecessor", async () => {
      const { fundId, head } = await fundWithOneEvent();
      await expect(
        insertForged(sql, {
          fundId,
          seq: head.seq + 1,
          prevHash: head.hash,
          occurredAt: "2025-12-31T23:59:59.000Z",
        }),
      ).rejects.toThrow(/occurred_at moved backwards/);
    });

    it("accepts the same row once the one wrong field is corrected", async () => {
      const { fundId, head } = await fundWithOneEvent();
      await expect(
        insertForged(sql, {
          fundId,
          seq: head.seq + 1,
          prevHash: head.hash,
          occurredAt: "2026-01-01T00:00:01.000Z",
        }),
      ).resolves.toMatch(/^[0-9a-f]{64}$/);
    });

    it("makes a racing insert wait for the per-fund lock instead of failing on a stale head", async () => {
      const { fundId, head } = await fundWithOneEvent();
      const secondAt = "2026-01-01T00:00:01.000Z";
      const second = await computeEventHash({
        fund_id: fundId,
        seq: head.seq + 1,
        type: "fund.visibility_changed",
        version: 1,
        actor,
        occurred_at: secondAt,
        payload: { visibility: "public" },
        prev_hash: head.hash,
      });

      let firstInserted!: () => void;
      const firstDone = new Promise<void>((resolve) => {
        firstInserted = resolve;
      });
      let commitFirst!: () => void;
      const gate = new Promise<void>((resolve) => {
        commitFirst = resolve;
      });
      const first = sql.begin(async (tx) => {
        await insertForged(tx, {
          fundId,
          seq: head.seq + 1,
          prevHash: head.hash,
          occurredAt: secondAt,
        });
        firstInserted();
        await gate;
      });
      await firstDone;

      // The second insert targets seq + 2 and links to the first, uncommitted, row.
      const racing = sql.begin((tx) =>
        insertForged(tx, {
          fundId,
          seq: head.seq + 2,
          prevHash: second,
          occurredAt: "2026-01-01T00:00:02.000Z",
        }),
      );

      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt += 1) {
        const rows = await sql`
          SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
        `;
        waiting = rows.length > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(waiting).toBe(true);

      commitFirst();
      await first;
      await expect(racing).resolves.toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("tampering detection (flipping one byte in stored row)", () => {
    it("detects flipped byte in event hash and reports the exact broken event", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      const events: Event[] = [];
      for (let i = 1; i <= 5; i++) {
        const stored = await appendEvent(sql, {
          fundId,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt: `2026-01-01T00:0${i}:00.000Z`,
          payload: { org_id: orgId, visibility: "private" },
        });
        events.push(stored);
      }

      const lastEvent = events[4];
      const middleEvent = events[2];
      if (!lastEvent || !middleEvent) {
        throw new Error("Missing expected events");
      }
      const expectedHead = chainHead({
        fundId,
        count: 5,
        latestHash: lastEvent.hash,
      });

      // Verify chain is intact initially
      const cleanVerify = await verifyStoredChain(sql, fundId, expectedHead);
      expect(cleanVerify.ok).toBe(true);

      // Superuser flips one byte in hash of seq = 3 using session_replication_role
      const targetHash = middleEvent.hash;
      const flippedHash =
        targetHash[0] === "a" ? `b${targetHash.slice(1)}` : `a${targetHash.slice(1)}`;

      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`;
        await tx`UPDATE fund_events SET hash = ${flippedHash} WHERE fund_id = ${fundId} AND seq = 3`;
      });

      // Verify break is detected at index 2, seq 3
      const tamperedVerify = await verifyStoredChain(sql, fundId, expectedHead);
      expect(tamperedVerify).toEqual({
        ok: false,
        index: 2,
        seq: 3,
        reason: "wrong hash",
      });
    });

    it("detects flipped byte in payload and reports the exact broken event", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      const events: Event[] = [];
      for (let i = 1; i <= 3; i++) {
        const stored = await appendEvent(sql, {
          fundId,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt: `2026-01-01T00:0${i}:00.000Z`,
          payload: { org_id: orgId, visibility: "private" },
        });
        events.push(stored);
      }

      const lastEvent = events[2];
      if (!lastEvent) {
        throw new Error("Missing expected events");
      }
      const expectedHead = chainHead({
        fundId,
        count: 3,
        latestHash: lastEvent.hash,
      });

      // Tamper with payload of seq = 2
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`;
        await tx`UPDATE fund_events SET payload = '{"org_id":"00000000-0000-0000-0000-000000000000","visibility":"private"}'::jsonb WHERE fund_id = ${fundId} AND seq = 2`;
      });

      const tamperedVerify = await verifyStoredChain(sql, fundId, expectedHead);
      expect(tamperedVerify).toEqual({
        ok: false,
        index: 1,
        seq: 2,
        reason: "wrong hash",
      });
    });
  });

  describe("golden events and canonical vectors", () => {
    it("SQL canonicalizer and hash agree with independent Python golden events", async () => {
      const goldenRaw = await readFile(join(vectorsDir, "golden-events.json"), "utf8");
      const golden = JSON.parse(goldenRaw) as {
        genesis_hash: string;
        latest_hash: string;
        events: Array<{
          event: {
            fund_id: string;
            seq: number;
            type: string;
            version: number;
            actor: string;
            occurred_at: string;
            payload: Record<string, unknown>;
            prev_hash: string;
            hash: string;
          };
          canonical: string;
        }>;
      };

      const firstItem = golden.events[0];
      if (!firstItem) {
        throw new Error("Missing golden events");
      }
      const fundId = fundIdSchema.parse(firstItem.event.fund_id);
      await createTestFund(sql, fundId);

      for (const item of golden.events) {
        const e = item.event;
        // Direct SQL insert verifying that DB trigger computes exact same canonical envelope and hash
        const rows = await sql`
          INSERT INTO fund_events (
            fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
          ) VALUES (
            ${e.fund_id}, ${e.seq}, ${e.type}, ${e.version}, ${e.actor}, ${e.occurred_at},
            ${sql.json(e.payload as Parameters<typeof sql.json>[0])}, ${e.prev_hash}, ${e.hash}, ${item.canonical}
          )
          RETURNING canonical_envelope, hash
        `;
        expect(rows[0]?.canonical_envelope).toBe(item.canonical);
        expect(rows[0]?.hash).toBe(e.hash);
      }

      const expectedHead = chainHead({
        fundId,
        count: golden.events.length,
        latestHash: hashHexSchema.parse(golden.latest_hash),
      });

      const verification = await verifyStoredChain(sql, fundId, expectedHead);
      expect(verification.ok).toBe(true);
      if (verification.ok) {
        expect(verification.count).toBe(golden.events.length);
        expect(verification.latestHash).toBe(golden.latest_hash);
      }
    });

    it("SQL canonicalizer matches canonical-vectors.json", async () => {
      const vectorsRaw = await readFile(join(vectorsDir, "canonical-vectors.json"), "utf8");
      const vectors = JSON.parse(vectorsRaw) as Array<{
        name: string;
        input: unknown;
        canonical?: string;
        error?: string;
      }>;

      for (const vec of vectors) {
        if (vec.error !== undefined) {
          // Lone surrogate must be rejected
          if (vec.name === "lone_surrogate") {
            await expect(
              sql`SELECT yen_canonicalize_jsonb(${sql.json(vec.input as Parameters<typeof sql.json>[0])})`,
            ).rejects.toThrow();
          }
          continue;
        }

        if (vec.name === "escapes") {
          // Contains \u0000 which PostgreSQL text/json cannot store
          continue;
        }

        const res =
          await sql`SELECT yen_canonicalize_jsonb(${sql.json(vec.input as Parameters<typeof sql.json>[0])}) AS canonical`;
        expect(res[0]?.canonical).toBe(vec.canonical);
      }
    });
  });

  describe("head lookup cannot be spoofed by temporary tables (R1)", () => {
    it("rejects real insert when non-superuser app role creates temp fund_events table with fake head", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      // Insert real event at seq 1
      await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      // Create a non-superuser application role
      const roleName = `yen_app_spoof_${uuidv7().replaceAll("-", "")}`;
      const dbName = new URL(url).pathname.slice(1);
      await sql`CREATE ROLE ${sql(roleName)} WITH LOGIN PASSWORD 'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`;
      await sql`GRANT CONNECT ON DATABASE ${sql(dbName)} TO ${sql(roleName)}`;
      await sql`GRANT USAGE ON SCHEMA public TO ${sql(roleName)}`;
      await sql`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${sql(roleName)}`;

      const appUrl = new URL(url);
      appUrl.username = roleName;
      appUrl.password = "app_pw";
      const appSql = createSql(appUrl.toString());

      try {
        // App role creates a TEMP TABLE named fund_events with a fake head at seq 98
        await appSql`
          CREATE TEMP TABLE fund_events (
            fund_id uuid,
            seq bigint,
            type text,
            version integer,
            actor text,
            occurred_at text,
            payload jsonb,
            prev_hash text,
            hash text,
            canonical_envelope text
          )
        `;
        const fakeHash = "a".repeat(64);
        await appSql`
          INSERT INTO fund_events (fund_id, seq, hash, occurred_at)
          VALUES (${fundId}, 98, ${fakeHash}, '2026-01-01T00:00:00.000Z')
        `;

        // App role attempts to insert seq 99 into real table using the fake head as predecessor
        await expect(
          insertRawEnvelope(appSql, {
            fundId,
            seq: 99,
            type: "fund.visibility_changed",
            version: 1,
            actor,
            occurredAt: "2026-01-01T00:01:00.000Z",
            payload: { visibility: "public" },
            prevHash: fakeHash,
          }),
        ).rejects.toThrow(/Event seq gap: expected 2, got 99/);

        // Verify public.fund_events only has seq 1
        const rows = await sql`SELECT seq FROM fund_events WHERE fund_id = ${fundId}`;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0]?.seq)).toBe(1);
      } finally {
        await appSql.end();
        await sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${sql(roleName)}`;
        await sql`REVOKE ALL ON SCHEMA public FROM ${sql(roleName)}`;
        await sql`REVOKE CONNECT ON DATABASE ${sql(dbName)} FROM ${sql(roleName)}`;
        await sql`DROP ROLE ${sql(roleName)}`;
      }
    });
  });

  describe("payload validation against TypeScript schemas (R2)", () => {
    const invalidPayloads: Record<string, unknown> = {
      "fund.created": { org_id: null, visibility: "public" },
      "fund.policy_changed": { approval_quorum: 1 },
      "fund.visibility_changed": { unexpected: 0 },
      "member.added": { member_id: "not-a-psn", role: "member" },
      "member.removed": { member_id: null },
      "donation.pledged": { donation_id: "00000000-0000-0000-0000-000000000000", amount_paise: -5 },
      "donation.verified": {
        donation_id: "00000000-0000-0000-0000-000000000000",
        bank_transaction_id: null,
      },
      "donation.rejected": {
        donation_id: "00000000-0000-0000-0000-000000000000",
        reason: "invalid_reason",
      },
      "expense.submitted": {
        expense_id: "00000000-0000-0000-0000-000000000000",
        amount_paise: "100",
      },
      "expense.evidence_added": {
        expense_id: "00000000-0000-0000-0000-000000000000",
        evidence_id: "00000000-0000-0000-0000-000000000000",
        content_sha256: "short",
      },
      "expense.flagged": { expense_id: "00000000-0000-0000-0000-000000000000", reason: null },
      "expense.objection_raised": { expense_id: "00000000-0000-0000-0000-000000000000" },
      "expense.objection_resolved": {
        expense_id: "00000000-0000-0000-0000-000000000000",
        objection_id: "00000000-0000-0000-0000-000000000000",
        resolution: "unknown",
      },
      "expense.approved": { expense_id: null },
      "expense.rejected": { expense_id: "00000000-0000-0000-0000-000000000000", reason: "bad" },
      "expense.expired": { expense_id: "bad-id", extra: 1 },
      "expense.paid": {
        expense_id: "00000000-0000-0000-0000-000000000000",
        bank_transaction_id: "bad-uuid",
      },
      "expense.reversed": { expense_id: "00000000-0000-0000-0000-000000000000" },
      "bank.credit_seen": {
        bank_transaction_id: "00000000-0000-0000-0000-000000000000",
        amount_paise: 0,
      },
      "bank.debit_seen": {
        bank_transaction_id: "00000000-0000-0000-0000-000000000000",
        amount_paise: null,
      },
      "bank.balance_checked": { balance_paise: "100" },
      "discrepancy.raised": {
        discrepancy_id: "00000000-0000-0000-0000-000000000000",
        bank_transaction_id: "00000000-0000-0000-0000-000000000000",
        kind: "bad_kind",
      },
      "discrepancy.resolved": {
        discrepancy_id: "00000000-0000-0000-0000-000000000000",
        resolution: null,
      },
      "anchor.published": {
        anchor_id: "00000000-0000-0000-0000-000000000000",
        global_root: "xyz",
      },
    };

    const eventTypes = Object.keys(invalidPayloads);

    it.each(eventTypes)(
      "rejects invalid canonical and correctly hashed payload for %s",
      async (eventType) => {
        const fundId = await createTestFund(sql);
        const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
        const payload = invalidPayloads[eventType];

        await expect(
          insertRawEnvelope(sql, {
            fundId,
            seq: 1,
            type: eventType,
            version: 1,
            actor,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload,
            prevHash: genesisHash,
          }),
        ).rejects.toThrow(new RegExp(`Invalid payload for ${eventType}`));
      },
    );

    it("accepts valid payloads for every event type from golden vectors", async () => {
      const goldenJson = JSON.parse(await readFile(join(vectorsDir, "golden-events.json"), "utf8"));
      const events: Array<{ event: Event }> = goldenJson.events;
      const seenTypes = new Set<string>();

      for (const item of events) {
        seenTypes.add(item.event.type);
      }
      expect(seenTypes.size).toBe(24);

      // Verify each event type can be inserted when valid
      for (const item of events) {
        const fundId = await createTestFund(sql);
        const ev = item.event;
        await expect(
          insertRawEnvelope(sql, {
            fundId,
            seq: 1,
            type: ev.type,
            version: ev.version,
            actor: ev.actor,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload: ev.payload,
            prevHash: genesisHash,
          }),
        ).resolves.toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe("impossible timestamps rejected by database triggers (R3)", () => {
    it.each([
      ["2026-02-30T00:00:00.000Z", "impossible date Feb 30"],
      ["2026-02-29T00:00:00.000Z", "Feb 29 in non-leap year"],
      ["2026-13-01T00:00:00.000Z", "impossible month 13"],
      ["2026-01-32T00:00:00.000Z", "impossible day 32"],
      ["2026-01-01T24:00:00.000Z", "impossible clock hour 24"],
    ])("rejects %s (%s) on direct insert with valid hash", async (occurredAt) => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      await expect(
        insertRawEnvelope(sql, {
          fundId,
          seq: 1,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt,
          payload: { org_id: orgId, visibility: "private" },
          prevHash: genesisHash,
        }),
      ).rejects.toThrow(/Invalid occurred_at/);
    });

    it("accepts valid leap-day 2028-02-29T00:00:00.000Z on direct insert with valid hash", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      await expect(
        insertRawEnvelope(sql, {
          fundId,
          seq: 1,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt: "2028-02-29T00:00:00.000Z",
          payload: { org_id: orgId, visibility: "private" },
          prevHash: genesisHash,
        }),
      ).resolves.toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("verify-chain CLI", () => {
    it("runs the actual command against a stored chain and detects a tampered hash", async () => {
      const fundId = await createTestFund(sql);
      const event = await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgIdSchema.parse(uuidv7()), visibility: "private" },
      });
      const run = (...args: string[]) =>
        spawnSync("pnpm", ["--filter", "@yen/db", "verify-chain", ...args], {
          env: { ...process.env, DATABASE_URL: url },
          encoding: "utf8",
        });
      const valid = run(fundId, "--head", event.hash, "--count", "1");
      expect(valid.status, valid.stderr).toBe(0);
      expect(valid.stdout).toContain("Chain verified against expected head: count=1");
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`;
        await tx`UPDATE fund_events SET hash = ${"e".repeat(64)} WHERE fund_id = ${fundId}`;
      });
      const broken = run(fundId);
      expect(broken.status).toBe(1);
      expect(broken.stderr).toContain("Chain structure break");
    });

    it("prints help text and explains it is a consistency check, not authenticity proof", async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      const code = await runVerifyCli(["--help"], process.env, {
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
      });

      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("internal database consistency check");
      expect(logs.join("\n")).toContain("NOT an authenticity proof");
    });

    it("runs consistency check on valid fund chain", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      const logs: string[] = [];
      const errors: string[] = [];
      const code = await runVerifyCli(
        [fundId],
        { ...process.env, DATABASE_URL: url },
        {
          log: (m) => logs.push(m),
          error: (m) => errors.push(m),
        },
      );

      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("Chain structure consistent: count=1");
    });

    it("verifies chain against supplied --head and --count", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      const event = await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      const logs: string[] = [];
      const errors: string[] = [];
      const code = await runVerifyCli(
        [fundId, "--head", event.hash, "--count", "1"],
        { ...process.env, DATABASE_URL: url },
        {
          log: (m) => logs.push(m),
          error: (m) => errors.push(m),
        },
      );

      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("Chain verified against expected head");
    });

    it("reports break and exits 1 on broken chain", async () => {
      const fundId = await createTestFund(sql);
      const actor = pseudonymIdSchema.parse(`psn_${uuidv7()}`);
      const orgId = orgIdSchema.parse(uuidv7());

      const event = await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "private" },
      });

      // Tamper with hash
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`;
        await tx`UPDATE fund_events SET hash = ${"e".repeat(64)} WHERE fund_id = ${fundId}`;
      });

      const logs: string[] = [];
      const errors: string[] = [];
      const code = await runVerifyCli(
        [fundId, "--head", event.hash, "--count", "1"],
        { ...process.env, DATABASE_URL: url },
        {
          log: (m) => logs.push(m),
          error: (m) => errors.push(m),
        },
      );

      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("Chain verification break");
    });
  });
});
