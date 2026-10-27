import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chainHead,
  type Event,
  genesisHash,
  hashHexSchema,
  pseudonymIdSchema,
} from "@yen/eventlog";
import { type FundId, fundIdSchema, orgIdSchema, userIdSchema } from "@yen/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createSql, type Sql } from "./client.js";
import { appendEvent, checkStoredChainStructure, verifyStoredChain } from "./events.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";
import { runVerifyCli } from "./verify-cli.js";

const vectorsDir = fileURLToPath(new URL("../../eventlog/test-vectors/", import.meta.url));

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

  describe("verify-chain CLI", () => {
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
