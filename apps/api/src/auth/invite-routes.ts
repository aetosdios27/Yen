import crypto from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import {
  confirmOwnerInviteRoute,
  createOwnerInviteRoute,
  listOwnerInvitesRoute,
  redeemOwnerInviteRoute,
} from "../contract.js";
import type { ApiEnv, AppDependencies, Principal } from "../dependencies.js";
import { ApiError } from "../errors.js";
import type { ExistingFundResource, FundAction, FundResource } from "../policy.js";
import {
  generateSessionToken,
  hashSessionToken,
  normalizePhone,
  parseDeviceInfo,
} from "./index.js";

type GetFund = (fundId: string) => Promise<{ id: string; resource: ExistingFundResource }>;
type AuthorizeFund = (
  context: Context<ApiEnv>,
  action: FundAction,
  resource: FundResource,
) => Promise<Principal>;

export function registerOwnerInviteRoutes(
  app: OpenAPIHono<ApiEnv>,
  deps: AppDependencies,
  getFund: GetFund,
  authorizeFund: AuthorizeFund,
): void {
  app.openapi(createOwnerInviteRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = await getFund(fundId);
    const owner = await authorizeFund(c, "fund:member:add", resource);
    const phone = normalizePhone(c.req.valid("json").phone);
    if (!phone) throw new ApiError("validation_failed");
    const now = deps.clock();
    const inviteId = deps.idGenerator();
    const code = crypto.randomBytes(32).toString("hex");
    await deps.authStore.createOwnerInvite({
      id: inviteId,
      fundId: id,
      ownerId: owner.id,
      phone,
      memberName: null,
      secretHash: crypto.createHash("sha256").update(code).digest("hex"),
      expiresAt: now + 5 * 60_000,
      redeemedAt: null,
      confirmedAt: null,
      completedAt: null,
      createdAt: now,
    });
    return c.json({ inviteId, code, expiresAt: new Date(now + 5 * 60_000).toISOString() }, 201);
  });

  app.openapi(listOwnerInvitesRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = await getFund(fundId);
    const owner = await authorizeFund(c, "fund:member:add", resource);
    const invites = await deps.authStore.listOwnerInvites(id, owner.id);
    return c.json(
      {
        invites: invites
          .filter((invite) => deps.clock() < invite.expiresAt)
          .map((invite) => ({
            inviteId: invite.id,
            displayName: invite.memberName,
            phoneEnding: invite.phone.slice(-4),
            status: invite.redeemedAt === null ? ("issued" as const) : ("redeemed" as const),
          })),
      },
      200,
    );
  });

  app.openapi(confirmOwnerInviteRoute, async (c) => {
    const { fundId, inviteId } = c.req.valid("param");
    const { id, resource } = await getFund(fundId);
    const owner = await authorizeFund(c, "fund:member:add", resource);
    const invite = await deps.authStore.confirmOwnerInvite(inviteId, id, owner.id, deps.clock());
    if (!invite) throw new ApiError("not_found");
    return c.json(
      {
        status: "confirmed" as const,
        displayName: invite.memberName ?? "Member",
        phoneEnding: invite.phone.slice(-4),
      },
      200,
    );
  });

  app.openapi(redeemOwnerInviteRoute, async (c) => {
    const { code, phone: inputPhone, displayName } = c.req.valid("json");
    const phone = normalizePhone(inputPhone);
    if (!phone) throw new ApiError("not_found");
    const now = deps.clock();
    const secretHash = crypto.createHash("sha256").update(code).digest("hex");
    const invite = await deps.authStore.redeemOwnerInvite(secretHash, phone, displayName, now);
    if (!invite) throw new ApiError("not_found");
    if (invite.confirmedAt === null) {
      return c.json({ status: "pending_owner_confirmation" as const }, 200);
    }
    const user = await deps.authStore.completeOwnerInvite(secretHash, phone, now);
    if (!user) throw new ApiError("conflict");
    const token = generateSessionToken();
    const expiresAt = now + deps.sessionMaxAgeSeconds * 1000;
    const session = await deps.authStore.createSession({
      id: deps.idGenerator(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      userAgent: c.req.header("user-agent") ?? "",
      deviceInfo: parseDeviceInfo(c.req.header("user-agent")),
      ipAddress: deps.clientIp(c),
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
    });
    await deps.authStore.trustDevice(session.id, user.id, now, deps.trustedDeviceIdleTimeoutMs);
    setCookie(c, deps.sessionCookieName, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: deps.sessionMaxAgeSeconds,
    });
    return c.json(
      {
        status: "authenticated" as const,
        session: {
          id: session.id,
          token,
          expiresAt: new Date(expiresAt).toISOString(),
          user: {
            id: user.id,
            phone: user.phone,
            displayName: user.displayName,
            locale: user.locale,
          },
        },
      },
      200,
    );
  });
}
