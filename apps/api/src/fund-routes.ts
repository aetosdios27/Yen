import type { OpenAPIHono } from "@hono/zod-openapi";
import type { getBalances } from "@yen/ledger";
import type { Context } from "hono";
import { changeFundVisibilityRoute, fundBalancesSchema, getFundBalancesRoute } from "./contract.js";
import type { ApiEnv, FundStore, Principal } from "./dependencies.js";
import { ApiError, StoreError } from "./errors.js";
import type { ExistingFundResource, FundAction, Policy } from "./policy.js";

interface FundLookup {
  id: string;
  resource: ExistingFundResource;
}

interface VisibilityRouteDependencies {
  fundStore: FundStore;
  readFundBalances:
    | ((fundId: string) => Promise<Awaited<ReturnType<typeof getBalances>>>)
    | undefined;
  getFund: (fundId: string) => Promise<FundLookup>;
  authorizeFund: (
    context: Context<ApiEnv>,
    action: FundAction,
    resource: ExistingFundResource,
  ) => Principal;
  policy: Policy;
  clock: () => number;
}

export function registerFundVisibilityRoute(
  app: OpenAPIHono<ApiEnv>,
  deps: VisibilityRouteDependencies,
): void {
  app.openapi(getFundBalancesRoute, async (c) => {
    const { id, resource } = await deps.getFund(c.req.valid("param").fundId);
    const principal = deps.authorizeFund(c, "fund:read", resource);
    const roles = [principal.role, ...(principal.roles ?? [])];
    if (
      !roles.some(
        (role) =>
          role === "owner" || role === "treasurer" || role === "approver" || role === "auditor",
      )
    ) {
      throw new ApiError("forbidden");
    }
    if (!deps.readFundBalances) {
      c.header("retry-after", "1");
      throw new ApiError("overloaded");
    }
    const balances = await deps.readFundBalances(id);
    c.header("cache-control", "private, no-store");
    return c.json(redactFundBalances(balances), 200);
  });
  app.openapi(changeFundVisibilityRoute, async (c) => {
    const { id, resource } = await deps.getFund(c.req.valid("param").fundId);
    const principal = deps.authorizeFund(c, "fund:policy:change", resource);
    if (!deps.fundStore.changeVisibility) throw new StoreError();
    const body = c.req.valid("json");
    const updated = await deps.fundStore.changeVisibility({
      fundId: id,
      ownerUserId: principal.id,
      visibility: body.visibility,
      expectedVersion: body.expectedVersion,
      occurredAt: new Date(deps.clock()).toISOString(),
    });
    if (!updated) throw new ApiError("conflict");
    return c.json(deps.policy.redact(principal, { kind: "fund", fund: updated }), 200);
  });
}

function redactFundBalances(balances: Awaited<ReturnType<typeof getBalances>>) {
  return fundBalancesSchema.parse({
    bankPaise: balances.bankPaise.toString(),
    reservedPaise: balances.pendingSpendPaise.toString(),
    availablePaise: balances.availablePaise.toString(),
  });
}
