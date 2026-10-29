import { z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { routePath } from "hono/route";
import { hashSessionToken } from "./auth/index.js";
import { idempotencyKey } from "./contract.js";
import type { ApiEnv, AppDependencies } from "./dependencies.js";
import { ApiError, errorBody, errorStatus, StoreError } from "./errors.js";
import { logMethod } from "./logging.js";

export function isWaitlistRoute(path: string): boolean {
  return path.replace(/\/$/, "") === "/v1/waitlist";
}

export function isPledgeRoute(path: string): boolean {
  return /^\/v1\/funds\/[0-9a-f-]{36}\/donations\/pledge\/?$/.test(path);
}

export function isPublicDonationRoute(path: string): boolean {
  return /^\/v1\/funds\/[0-9a-f-]{36}\/(?:donations\/pledge|donation-details)\/?$/.test(path);
}

export function isPublicFundReadRoute(path: string): boolean {
  return /^\/v1\/funds\/[0-9a-f-]{36}\/public\/(?:summary|breakdown|timeline)\/?$/.test(path);
}

export function isAuthRoute(path: string): boolean {
  return path.replace(/\/$/, "").startsWith("/v1/auth");
}

export function isPublicAuthRoute(path: string): boolean {
  const clean = path.replace(/\/$/, "");
  return clean === "/v1/auth/otp/send" || clean === "/v1/auth/otp/verify";
}

export function isPendingDeviceAuthRoute(path: string): boolean {
  const clean = path.replace(/\/$/, "");
  return (
    clean === "/v1/auth/logout" ||
    clean === "/v1/auth/pin/setup" ||
    clean === "/v1/auth/pin/reset/request" ||
    clean === "/v1/auth/pin/reset/confirm" ||
    clean === "/v1/auth/device/unlock"
  );
}

export function isHealthRoute(path: string): boolean {
  const normalized = path.replace(/\/$/, "");
  return normalized === "/health" || normalized === "/ready";
}

export function isEvidenceRoute(path: string): boolean {
  return /^\/v1\/funds\/[^/]+\/expenses\/[^/]+\/evidence\/?$/.test(path);
}

async function storeCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new StoreError();
  }
}

export const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!c.get("principal")) throw new ApiError("unauthenticated");
  await next();
};

const requestId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const method = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export function requestContext(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const inbound = requestId.safeParse(c.req.header("x-request-id"));
    c.set("requestId", inbound.success ? inbound.data : requestId.parse(deps.idGenerator()));

    const authHeader = c.req.header("authorization");
    let sessionToken: string | undefined;
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      sessionToken = authHeader.slice(7).trim();
    } else {
      sessionToken = getCookie(c, deps.sessionCookieName);
    }

    if (sessionToken) {
      const tokenHash = hashSessionToken(sessionToken);
      const session = await storeCall(() =>
        deps.authStore.findSessionByTokenHash(tokenHash, deps.clock()),
      );
      if (session) {
        const now = deps.clock();
        const trustedDevice = await storeCall(() =>
          deps.authStore.getTrustedDevice(session.id, now),
        );
        const isTrusted =
          trustedDevice?.userId === session.userId && now < trustedDevice.idleExpiresAt;
        const pendingDeviceAuth = isPendingDeviceAuthRoute(c.req.path);
        c.set("principal", isTrusted || pendingDeviceAuth ? { id: session.userId } : null);
        c.set("session", session);
        if (isTrusted) {
          await storeCall(() =>
            deps.authStore.touchTrustedDevice(session.id, now, deps.trustedDeviceIdleTimeoutMs),
          );
          await storeCall(() => deps.authStore.touchSession(session.id, now));
        }
      } else {
        c.set("principal", deps.principal);
        c.set("session", null);
      }
    } else {
      c.set("principal", deps.principal);
      c.set("session", null);
    }

    c.header("x-request-id", c.get("requestId"));
    const started = deps.clock();
    await next();
    if (isWaitlistRoute(c.req.path)) {
      const remaining = deps.waitlistMinResponseMs - (deps.clock() - started);
      if (remaining > 0) await deps.sleep(remaining);
    }
    c.header("x-request-id", c.get("requestId"));
    const parsedMethod = method.safeParse(c.req.method);
    deps.logger.log({
      event: "http_request",
      requestId: c.get("requestId"),
      method: parsedMethod.success ? parsedMethod.data : "OTHER",
      route: routePath(c, -1) || "unmatched",
      status: c.res.status,
      durationMs: Math.max(0, deps.clock() - started),
    });
  };
}

// Backpressure and load shedding middleware. Only admitted, non-health requests hold an
// in-flight slot. The slot is released when `next()` settles, so a request that timed out
// (see requestTimeout) keeps its slot until its handler actually finishes. A rejected request
// never takes a slot, so a burst of rejections cannot keep the limiter tripped.
// Rejections return 503 with Retry-After: 1 and are logged as warnings.
// Primary doc: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503
export function concurrencyLimit(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (isHealthRoute(c.req.path)) {
      return next();
    }
    if (deps.inFlightTracker.count >= deps.concurrencyLimit) {
      deps.logger.log({
        event: "http_overloaded",
        level: "warn",
        reason: "overloaded",
        requestId: c.get("requestId"),
        method: logMethod(c.req.method),
        route: routePath(c, -1) || "unmatched",
        inFlight: deps.inFlightTracker.count,
      });
      c.header("retry-after", "1");
      return c.json(
        errorBody(new ApiError("overloaded"), c.get("requestId")),
        errorStatus.overloaded,
      );
    }
    deps.inFlightTracker.inc();
    try {
      await next();
    } finally {
      deps.inFlightTracker.dec();
    }
  };
}

// Per-request timeout middleware. When deps.requestTimeoutMs elapses the client receives
// 504 gateway_timeout, but the handler is NOT cancelled: it keeps running, and it keeps its
// in-flight slot (see concurrencyLimit) until it settles. Handlers that write must therefore
// be idempotent. Health checks are excluded so that probes never time out under load.
// Primary doc: https://hono.dev/docs/middleware/builtin/timeout
export function requestTimeout(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (isHealthRoute(c.req.path) || deps.requestTimeoutMs <= 0) {
      return next();
    }
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError("gateway_timeout"));
      }, deps.requestTimeoutMs);
    });
    try {
      await Promise.race([next(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function rateLimit(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = c.get("principal");
    const now = deps.clock();
    // Unauthenticated money routes get their own fixed window per IP.
    const fixedWindow = isPledgeRoute(c.req.path)
      ? ({ scope: "pledge", limit: deps.pledgeLimit } as const)
      : isWaitlistRoute(c.req.path)
        ? ({ scope: "waitlist", limit: deps.waitlistLimit } as const)
        : null;
    const limits = fixedWindow
      ? [
          {
            key: JSON.stringify([
              fixedWindow.scope,
              deps.clientIp(c),
              Math.floor(now / fixedWindow.limit.refillMs),
            ]),
            limit: {
              capacity: fixedWindow.limit.capacity,
              refillMs: fixedWindow.limit.refillMs,
              expiresAt:
                (Math.floor(now / fixedWindow.limit.refillMs) + 1) * fixedWindow.limit.refillMs,
            },
          },
        ]
      : [
          { key: JSON.stringify(["ip", deps.clientIp(c)]), limit: deps.rateLimits.ip },
          ...(principal
            ? [
                {
                  key: JSON.stringify(["principal", principal.id]),
                  limit: deps.rateLimits.principal,
                },
              ]
            : []),
        ];
    for (const { key, limit } of limits) {
      const result = await storeCall(() => deps.rateLimitStore.consume(key, limit, now));
      if (!result.allowed) {
        c.header(
          "retry-after",
          String(
            fixedWindow && !result.overloaded
              ? Math.max(
                  1,
                  Math.ceil(
                    (fixedWindow.limit.refillMs - (now % fixedWindow.limit.refillMs)) / 1000,
                  ),
                )
              : result.retryAfterSeconds,
          ),
        );
        throw new ApiError(result.overloaded ? "overloaded" : "rate_limited");
      }
    }
    await next();
  };
}

export function idempotency(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(c.req.method) ||
      isWaitlistRoute(c.req.path) ||
      isAuthRoute(c.req.path)
    )
      return next();
    // Anonymous donors still get replay protection; their key is scoped to the caller's IP.
    const principal = c.get("principal");
    const owner = principal?.id ?? (isPledgeRoute(c.req.path) ? `ip:${deps.clientIp(c)}` : null);
    if (owner === null) throw new ApiError("unauthenticated");
    const key = idempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) {
      throw new ApiError("validation_failed", [
        { path: ["header", "Idempotency-Key"], message: "Expected 1–128 ASCII key characters" },
      ]);
    }
    const metadata = new TextEncoder().encode(
      JSON.stringify([
        c.req.method,
        new URL(c.req.url).pathname + new URL(c.req.url).search,
        c.req.header("content-type") ?? "",
      ]),
    );
    const body = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    const input = new Uint8Array(metadata.length + body.length);
    input.set(metadata);
    input.set(body, metadata.length);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    const request = {
      key: JSON.stringify([owner, key.data]),
      requestHash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      createdAt: deps.clock(),
    };
    const reservation = await storeCall(() => deps.idempotencyStore.begin(request));
    if (reservation.kind !== "new") {
      if (reservation.requestHash !== request.requestHash || reservation.kind === "in_progress") {
        if (reservation.kind === "in_progress") c.header("retry-after", "1");
        throw new ApiError("idempotency_conflict");
      }
      c.res = new Response(
        reservation.response.bodyBase64 === null
          ? null
          : Uint8Array.from(atob(reservation.response.bodyBase64), (character) =>
              character.charCodeAt(0),
            ),
        {
          status: reservation.response.status,
          headers: reservation.response.headers,
        },
      );
      c.header("idempotent-replayed", "true");
      return;
    }
    try {
      await next();
      if (c.res.status >= 500) {
        await storeCall(() => deps.idempotencyStore.release(request, reservation.token));
        return;
      }
      await storeCall(async () =>
        deps.idempotencyStore.complete(request, reservation.token, {
          status: c.res.status,
          headers: [...c.res.headers],
          bodyBase64:
            c.res.body === null
              ? null
              : btoa(
                  Array.from(new Uint8Array(await c.res.clone().arrayBuffer()), (byte) =>
                    String.fromCharCode(byte),
                  ).join(""),
                ),
        }),
      );
    } catch (error) {
      await storeCall(() => deps.idempotencyStore.release(request, reservation.token));
      throw error;
    }
  };
}
