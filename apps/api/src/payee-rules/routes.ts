import type { OpenAPIHono } from "@hono/zod-openapi";
import type { PseudonymId } from "@yen/eventlog";
import { parsePseudonymId } from "@yen/eventlog";
import type { ExpenseRequest } from "@yen/ledger";
import { FraudAcknowledgementConflictError } from "@yen/ledger";
import type { FraudAcknowledgement, FraudPolicy, Payee } from "@yen/policy";
import type { FundId } from "@yen/shared";
import { paise, parseFundId } from "@yen/shared";
import type { Context } from "hono";
import type { ApiEnv, AppDependencies, Principal } from "../dependencies.js";
import { ApiError } from "../errors.js";
import type {
  ExpenseAction,
  ExpenseResource,
  ExpenseView,
  FundAction,
  FundRecord,
  FundResource,
} from "../policy.js";
import {
  acknowledgeFraudFlagRoute,
  clearMemberPayeeProfileRoute,
  payeeChangeRoute,
  setMemberPayeeProfileRoute,
  updatePayeeRulesPolicyRoute,
} from "./contract.js";
import { normalizedPayee } from "./schema.js";
import { evaluateExpensePayeeRules, fingerprintPayee } from "./service.js";

interface RouteHelpers {
  readonly getFund: (fundId: string) => Promise<{
    readonly id: FundId;
    readonly resource: { readonly kind: "fund"; readonly fund: FundRecord };
  }>;
  readonly authorizeFund: (
    context: Context<ApiEnv>,
    action: FundAction,
    resource: FundResource,
  ) => Principal;
  readonly authorizeExpense: (
    context: Context<ApiEnv>,
    action: ExpenseAction,
    resource: ExpenseResource,
  ) => Principal;
  readonly actorFor: (principal: Principal, fundId: string) => Promise<PseudonymId>;
  readonly expenseView: (expense: ExpenseRequest) => ExpenseView;
}

function ownerRole(principal: Principal): boolean {
  return principal.role === "owner" || principal.roles?.includes("owner") === true;
}

function makeExpenseResource(expense: ExpenseRequest, view: ExpenseView): ExpenseResource {
  return { kind: "expense", expense: { owner: expense.requesterId, expense: view } };
}

export function registerPayeeRuleRoutes(
  app: OpenAPIHono<ApiEnv>,
  deps: AppDependencies,
  helpers: RouteHelpers,
): void {
  app.openapi(payeeChangeRoute, async (c) => {
    const { fundId: rawFundId, expenseId } = c.req.valid("param");
    const fund = parseFundId(rawFundId);
    if (!fund.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fund.value) throw new ApiError("not_found");
    if (expense.status !== "draft" && expense.status !== "submitted")
      throw new ApiError("conflict");
    const principal = helpers.authorizeExpense(
      c,
      "expense:payee:change",
      makeExpenseResource(expense, helpers.expenseView(expense)),
    );
    const input = c.req.valid("json");
    const payeeInput = normalizedPayee(input);
    const payee: Payee = {
      ...payeeInput,
      verification: await deps.payeeVerifier.verify(payeeInput),
    };
    const fingerprint = fingerprintPayee(fund.value, payee.identity, deps.payeeFingerprintSalt);
    const now = new Date(deps.clock()).toISOString();
    const changed = expense.payeeFingerprint !== null && expense.payeeFingerprint !== fingerprint;
    const changedExpense: ExpenseRequest = {
      ...expense,
      payee,
      payeeFingerprint: fingerprint,
      lastPayeeChangedAt: changed ? now : expense.lastPayeeChangedAt,
      updatedAt: now,
    };
    const actionDetails = {
      action: "expense:payee:change",
      fundId: fund.value,
      targetId: expenseId,
      payeeFingerprint: fingerprint,
      payeeName: payee.name,
      payeeGstin: payee.gstin ?? null,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, {
      pin: c.req.header("x-approval-pin") ?? undefined,
      approvalToken: c.req.header("x-approval-token") ?? undefined,
    });
    const evaluated = await evaluateExpensePayeeRules({
      expense: changedExpense,
      priorExpenses: await deps.expenseStore.list(fund.value),
      profileStore: deps.payeeProfileStore,
      evidenceStore: deps.evidenceStore,
      now,
      policy: await deps.payeeProfileStore.getPolicy(fund.value),
    });
    const updated: ExpenseRequest = {
      ...changedExpense,
      ...evaluated,
    };
    await deps.expenseStore.save(updated);
    return c.json({ payee, fraudFlags: [...updated.fraudFlags] }, 200);
  });

  app.openapi(acknowledgeFraudFlagRoute, async (c) => {
    const { fundId: rawFundId, expenseId } = c.req.valid("param");
    const fund = parseFundId(rawFundId);
    if (!fund.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fund.value) throw new ApiError("not_found");
    const principal = helpers.authorizeExpense(
      c,
      "expense:fraud:acknowledge",
      makeExpenseResource(expense, helpers.expenseView(expense)),
    );
    if (expense.status !== "submitted") throw new ApiError("conflict");
    const input = c.req.valid("json");
    const policy = await deps.payeeProfileStore.getPolicy(fund.value);
    if (
      !expense.fraudFlags.some((flag) => flag.code === input.code) ||
      (input.code !== "self_payment" && !policy.blockedFlagCodes.includes(input.code))
    ) {
      throw new ApiError("conflict");
    }
    if (expense.fraudAcknowledgements.some((item) => item.code === input.code)) {
      throw new ApiError("conflict");
    }
    const actorPseudonym = await helpers.actorFor(principal, fund.value);
    const acknowledgement: FraudAcknowledgement = {
      code: input.code,
      actorPseudonym,
      reason: input.reason.trim(),
      acknowledgedAt: new Date(deps.clock()).toISOString(),
    };
    const actionDetails = {
      action: "expense:fraud:acknowledge",
      fundId: fund.value,
      targetId: expenseId,
      code: input.code,
      reason: acknowledgement.reason,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, {
      pin: c.req.header("x-approval-pin") ?? undefined,
      approvalToken: c.req.header("x-approval-token") ?? undefined,
    });
    const acknowledgements = [
      ...expense.fraudAcknowledgements.filter((item) => item.code !== input.code),
      acknowledgement,
    ];
    const updated = {
      ...expense,
      fraudAcknowledgements: acknowledgements,
      updatedAt: acknowledgement.acknowledgedAt,
    };
    try {
      await deps.expenseStore.save(updated);
    } catch (error) {
      if (error instanceof FraudAcknowledgementConflictError) throw new ApiError("conflict");
      throw error;
    }
    return c.json({ acknowledgements }, 200);
  });

  app.openapi(setMemberPayeeProfileRoute, async (c) => {
    const { fundId: rawFundId, pseudonymId } = c.req.valid("param");
    const fund = await helpers.getFund(rawFundId);
    const target = parsePseudonymId(pseudonymId);
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const actor = await helpers.actorFor(principal, fund.id);
    const resource = {
      kind: "member" as const,
      fund: fund.resource.fund,
      memberId: target,
      actorPseudonym: actor,
      targetRole: "member" as const,
    };
    if (!deps.policy.can(principal, "member:payee_profile:set", resource))
      throw new ApiError("forbidden");
    const self = actor === target;
    if (
      !self &&
      (!ownerRole(principal) ||
        !(await deps.payeeProfileStore.isActiveOfficeholder(fund.id, target)))
    ) {
      throw new ApiError("forbidden");
    }
    if (!(await deps.payeeProfileStore.isActiveMember(fund.id, target)))
      throw new ApiError("not_found");
    const payee = normalizedPayee(c.req.valid("json"));
    const fingerprint = fingerprintPayee(fund.id, payee.identity, deps.payeeFingerprintSalt);
    await deps.payeeProfileStore.set({
      fundId: fund.id,
      memberPseudonym: target,
      fingerprint,
      updatedAt: new Date(deps.clock()).toISOString(),
    });
    return c.json({ status: "set" as const }, 200);
  });

  app.openapi(clearMemberPayeeProfileRoute, async (c) => {
    const { fundId: rawFundId, pseudonymId } = c.req.valid("param");
    const fund = await helpers.getFund(rawFundId);
    const target = parsePseudonymId(pseudonymId);
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const actor = await helpers.actorFor(principal, fund.id);
    const resource = {
      kind: "member" as const,
      fund: fund.resource.fund,
      memberId: target,
      actorPseudonym: actor,
      targetRole: "member" as const,
    };
    if (!deps.policy.can(principal, "member:payee_profile:clear", resource))
      throw new ApiError("forbidden");
    const self = actor === target;
    if (
      !self &&
      (!ownerRole(principal) ||
        !(await deps.payeeProfileStore.isActiveOfficeholder(fund.id, target)))
    ) {
      throw new ApiError("forbidden");
    }
    if (!(await deps.payeeProfileStore.isActiveMember(fund.id, target)))
      throw new ApiError("not_found");
    await deps.payeeProfileStore.clear(fund.id, target);
    return c.json({ status: "cleared" as const }, 200);
  });

  app.openapi(updatePayeeRulesPolicyRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const fund = await helpers.getFund(fundId);
    helpers.authorizeFund(c, "fund:policy:change", fund.resource);
    const input = c.req.valid("json");
    const policy: FraudPolicy = {
      newPayeeFirstPaymentPaise: paise(Number(input.newPayeeFirstPaymentPaise)),
      largeExpensePaise: paise(Number(input.largeExpensePaise)),
      coolingOffHours: input.coolingOffHours,
      splitWindowHours: input.splitWindowHours,
      approvalThresholdPaise: paise(Number(input.approvalThresholdPaise)),
      velocityWindowHours: input.velocityWindowHours,
      velocityMaxPaise: paise(Number(input.velocityMaxPaise)),
      blockedFlagCodes: input.blockedFlagCodes,
    };
    await deps.payeeProfileStore.setPolicy(fund.id, policy, new Date(deps.clock()).toISOString());
    return c.json({ status: "updated" as const }, 200);
  });
}
