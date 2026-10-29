import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { changeFundVisibilityRoute } from "./contract.js";
import type { ApiEnv, FundStore, Principal } from "./dependencies.js";
import { ApiError, StoreError } from "./errors.js";
import type { ExistingFundResource, FundAction, Policy } from "./policy.js";

interface FundLookup {
  id: string;
  resource: ExistingFundResource;
}

interface VisibilityRouteDependencies {
  fundStore: FundStore;
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
