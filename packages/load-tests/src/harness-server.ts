import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Sql } from "@yen/db";
import { Hono } from "hono";
import { MemoryStateVerifier, type StateVerifier } from "./state-verifier.js";

export interface HarnessServerOptions {
  port?: number | undefined;
  sql?: Sql | undefined;
  stateVerifier?: StateVerifier | undefined;
}

export interface RunningHarnessServer {
  url: string;
  port: number;
  stateVerifier: StateVerifier;
  close: () => Promise<void>;
}

export function createHarnessApp(options: { stateVerifier: StateVerifier; sql?: Sql | undefined }) {
  const app = new Hono();
  const verifier = options.stateVerifier;
  const sql = options.sql;

  // Track idempotency keys and claimed UTRs in memory for fast load-test replay validation
  const idempotencyMap = new Map<
    string,
    { status: number; body: Record<string, unknown>; hash: string }
  >();
  const claimedUtrs = new Set<string>();

  // Scenario 1 (Read-heavy): /health, /v1/funds/{id}, public fund page
  app.get("/health", (c) => c.json({ status: "ok" as const }, 200));

  app.get("/v1/funds/:id", (c) => {
    const id = c.req.param("id");
    return c.json(
      {
        id,
        name: "RoboCup 2026 Asia Fund",
        targetPaise: "50000000",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      200,
    );
  });

  app.get("/funds/:id", (c) => {
    const id = c.req.param("id");
    return c.html(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Fund Transparency - ${id}</title></head>
<body><main><h1>RoboCup 2026 Asia Fund</h1><p>Target: ₹5,00,000</p></main></body>
</html>`,
      200,
    );
  });

  // Scenario 3 (Auth/Session): /v1/me and session validation
  app.get("/v1/me", (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthenticated", message: "Authentication required" }, 401);
    }
    const token = authHeader.slice(7).trim();
    if (token === "invalid-token" || token.length === 0) {
      return c.json({ error: "unauthenticated", message: "Invalid session token" }, 401);
    }
    return c.json(
      {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Verified Donor",
        locale: "en",
      },
      200,
    );
  });

  // Scenario 2 (Write-heavy): /v1/funds/{id}/donations/pledge with unique idempotency keys & UTRs
  app.post("/v1/funds/:id/donations/pledge", async (c) => {
    const fundId = c.req.param("id");
    const idempotencyKey = c.req.header("idempotency-key");

    if (!idempotencyKey) {
      return c.json(
        { error: "validation_failed", message: "Idempotency-Key header is required" },
        400,
      );
    }

    let body: { amountPaise?: string; utr?: string; donorName?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "validation_failed", message: "Invalid JSON body" }, 400);
    }

    const { amountPaise, utr, donorName } = body;

    // Validate amount
    if (!amountPaise || !/^[1-9][0-9]*$/.test(String(amountPaise))) {
      return c.json(
        { error: "validation_failed", message: "amountPaise must be a positive integer in paise" },
        400,
      );
    }

    // Validate UTR: 12-digit UPI reference
    if (!utr || !/^[0-9]{12}$/.test(String(utr))) {
      return c.json(
        { error: "validation_failed", message: "utr must be a 12-digit reference" },
        400,
      );
    }

    // Idempotency replay check
    const requestHash = `${fundId}:${amountPaise}:${utr}`;
    const existing = idempotencyMap.get(idempotencyKey);
    if (existing) {
      if (existing.hash === requestHash) {
        c.header("idempotent-replayed", "true");
        return c.json(existing.body, 201);
      }
      return c.json(
        { error: "conflict", message: "Idempotency key reused with different payload" },
        409,
      );
    }

    // UTR uniqueness check
    if (claimedUtrs.has(utr)) {
      return c.json({ error: "conflict", message: "UPI reference (UTR) already claimed" }, 409);
    }
    claimedUtrs.add(utr);

    const donationId = crypto.randomUUID();
    const responsePayload = {
      donationId,
      fundId,
      status: "pledged" as const,
      amountPaise: String(amountPaise),
    };

    // Record state side-effects in PostgreSQL or memory verifier
    if (sql) {
      try {
        await sql`
          INSERT INTO donation_pledges (id, fund_id, amount_paise, utr, donor_display_name, status)
          VALUES (
            ${donationId}::uuid,
            ${fundId}::uuid,
            ${BigInt(amountPaise)},
            ${utr},
            ${donorName ?? null},
            'pledged'
          )
        `;
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === "23505") {
          // unique_violation
          return c.json(
            { error: "conflict", message: "UPI reference (UTR) already claimed in database" },
            409,
          );
        }
        return c.json({ error: "internal", message: "Database insert error" }, 500);
      }
    } else if (verifier instanceof MemoryStateVerifier) {
      await verifier.recordPledge({
        id: donationId,
        fund_id: fundId,
        amount_paise: String(amountPaise),
        utr,
        donor_display_name: donorName ?? null,
        status: "pledged",
        created_at: new Date(),
      });
    }

    idempotencyMap.set(idempotencyKey, {
      status: 201,
      body: responsePayload,
      hash: requestHash,
    });

    return c.json(responsePayload, 201);
  });

  return app;
}

/**
 * Boots the load-test harness server on a designated or dynamic port.
 */
export async function startHarnessServer(
  options: HarnessServerOptions = {},
): Promise<RunningHarnessServer> {
  const stateVerifier = options.stateVerifier ?? new MemoryStateVerifier();
  if (options.sql) {
    await stateVerifier.ensureSchema();
  }

  const app = createHarnessApp({ stateVerifier, sql: options.sql });
  const server = createServer(async (req, res) => {
    const url = `http://${req.headers.host || "127.0.0.1"}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const val of v) headers.append(k, val);
      } else if (v !== undefined) {
        headers.set(k, v);
      }
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const body = ["POST", "PUT", "PATCH"].includes(req.method || "")
        ? Buffer.concat(chunks)
        : undefined;
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(body ? { body, duplex: "half" } : {}),
      });

      try {
        const response = await app.fetch(request);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => {
          res.setHeader(k, v);
        });
        const resBuffer = await response.arrayBuffer();
        res.end(Buffer.from(resBuffer));
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "internal" }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    stateVerifier,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
