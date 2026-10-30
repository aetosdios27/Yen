import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

/**
 * Minimal API used by the end to end suite.
 *
 * It answers the handful of routes the browser journey calls with seeded data,
 * so the suite exercises the real pages without needing Postgres or the queue.
 * Every route is in memory and resets when the server starts.
 */
const port = Number(process.env.E2E_API_PORT ?? 3939);
const fundId = "00000000-0000-4000-8000-0000000000f1";
const expenseId = "00000000-0000-4000-8000-0000000000e1";

const state = {
  fund: {
    fundId,
    name: "RoboCup 2026 Asia Fund",
    purpose: "Send the club team to the regional robotics championship",
    raisedPaise: "25000000",
    spentPaise: "7500000",
    verification: "bank-matched",
  },
  expenses: [
    {
      id: expenseId,
      fundId,
      requesterId: "psn_00000000-0000-4000-8000-000000000021",
      amountPaise: 250000,
      description: "Stage audio monitors",
      status: "submitted",
      category: "equipment",
      createdAt: "2026-10-29T10:00:00.000Z",
      updatedAt: "2026-10-29T10:05:00.000Z",
      submittedAt: "2026-10-29T10:05:00.000Z",
      approvals: [],
    },
  ],
  pledges: [],
};

const json = (response, status, body) => {
  const origin = response.req?.headers?.origin ?? "*";
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "content-type, idempotency-key, authorization, x-request-id, x-approval-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "private, no-store",
  });
  response.end(JSON.stringify(body));
};

const publicSummary = () => ({
  fundId,
  name: state.fund.name,
  purpose: state.fund.purpose,
  raisedPaise: state.fund.raisedPaise,
  spentPaise: state.fund.spentPaise,
  verification: state.fund.verification,
  dataGaps: [],
});

const publicBreakdown = () => ({
  fundId,
  categories: [{ category: "equipment", spentPaise: state.fund.spentPaise, transactionCount: 2 }],
  dataGaps: [],
});

const publicTimeline = () => ({
  fundId,
  items: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      occurredAt: "2026-10-28T09:00:00.000Z",
      message: "A donation was bank matched.",
      amountPaise: "5000000",
      verified: "bank-matched",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a2",
      occurredAt: "2026-10-29T10:00:00.000Z",
      message: "An approved expense was marked paid.",
      amountPaise: "7500000",
      verified: "unverified",
    },
  ],
  dataGaps: [],
});

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": request.headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers":
        "content-type, idempotency-key, authorization, x-request-id, x-approval-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (path === "/health") return json(response, 200, { status: "ok" });
  if (path === "/__state") return json(response, 200, state);

  if (request.method === "POST" && path === "/v1/auth/pin/verify") {
    request.resume();
    return json(response, 200, { approvalToken: `token-${randomUUID()}` });
  }

  if (request.method === "GET" && path === `/v1/funds/${fundId}/public/summary`)
    return json(response, 200, publicSummary());
  if (request.method === "GET" && path === `/v1/funds/${fundId}/public/breakdown`)
    return json(response, 200, publicBreakdown());
  if (request.method === "GET" && path === `/v1/funds/${fundId}/public/timeline`)
    return json(response, 200, publicTimeline());

  if (request.method === "GET" && path === `/v1/funds/${fundId}/donation-details`)
    return json(response, 200, {
      fundId,
      title: state.fund.name,
      upiVpa: "committee@yenbank",
      upiPayeeName: "Robotics Club Committee",
    });

  if (request.method === "GET" && path === `/v1/funds/${fundId}/expenses`)
    return json(response, 200, state.expenses);

  if (request.method === "GET" && path.startsWith(`/v1/funds/${fundId}/expenses/`)) {
    const id = path.split("/").pop();
    const expense = state.expenses.find((candidate) => candidate.id === id);
    return expense
      ? json(response, 200, expense)
      : json(response, 404, { error: { code: "not_found" } });
  }

  if (request.method === "POST" && path === "/v1/funds") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body || "{}");
      state.fund.name = input.name ?? state.fund.name;
      json(response, 201, { id: fundId, name: state.fund.name });
    });
    return;
  }

  if (request.method === "POST" && path === `/v1/funds/${fundId}/invites`) {
    request.resume();
    return json(response, 201, { code: `invite-${state.expenses.length}` });
  }

  if (request.method === "POST" && path === `/v1/funds/${fundId}/donations/pledge`) {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body || "{}");
      const claimed = state.pledges.some((pledge) => pledge.utr === input.utr);
      if (claimed) {
        return json(response, 409, { error: { code: "donation_utr_claimed", message: "claimed" } });
      }
      const pledge = {
        id: randomUUID(),
        fundId,
        amountPaise: Number(input.amountPaise),
        utr: input.utr,
        status: "pledged",
      };
      state.pledges.push(pledge);
      json(response, 201, pledge);
    });
    return;
  }

  if (request.method === "POST" && path === `/v1/funds/${fundId}/expenses`) {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body || "{}");
      const created = {
        ...state.expenses[0],
        id: randomUUID(),
        amountPaise: Number(input.amountPaise ?? 0),
        description: input.purpose ?? "New expense",
        status: "draft",
      };
      state.expenses.push(created);
      json(response, 201, created);
    });
    return;
  }

  const action = /^\/v1\/funds\/([^/]+)\/expenses\/([^/]+)\/(submit|approve|reject)$/.exec(path);
  if (request.method === "POST" && action) {
    request.resume();
    const [, , id, verb] = action;
    const expense = state.expenses.find((candidate) => candidate.id === id) ?? state.expenses[0];
    if (!expense) return json(response, 404, { error: { code: "not_found" } });
    expense.status = verb === "approve" ? "approved" : verb === "reject" ? "rejected" : "submitted";
    return json(response, 200, expense);
  }

  if (request.method === "POST" && path.endsWith("/evidence")) {
    request.resume();
    return json(response, 201, { evidenceId: randomUUID(), sha256: "a".repeat(64) });
  }

  if (request.method === "GET" && path === "/v1/me") {
    return json(response, 200, {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Treasurer",
      phone: "+919876543210",
      locale: "en",
    });
  }

  return json(response, 404, { error: { code: "not_found", message: `no stub for ${path}` } });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`stub api listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
