import { z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { idempotencyKey } from "./contract.js";
import type { ApiEnv, AppDependencies } from "./dependencies.js";
import { ApiError, StoreError } from "./errors.js";

export function isWaitlistRoute(path: string): boolean {
  return path.replace(/\/$/, "") === "/v1/waitlist";
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
    c.set("principal", deps.principal);
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

export function rateLimit(deps: AppDependencies): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = c.get("principal");
    const isWaitlist = isWaitlistRoute(c.req.path);
    const now = deps.clock();
    const limits = isWaitlist
      ? [
          {
            key: JSON.stringify([
              "waitlist",
              deps.clientIp(c),
              Math.floor(now / deps.waitlistLimit.refillMs),
            ]),
            limit: {
              capacity: deps.waitlistLimit.capacity,
              refillMs: deps.waitlistLimit.refillMs,
              expiresAt:
                (Math.floor(now / deps.waitlistLimit.refillMs) + 1) * deps.waitlistLimit.refillMs,
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
            isWaitlist && !result.overloaded
              ? Math.max(
                  1,
                  Math.ceil(
                    (deps.waitlistLimit.refillMs - (now % deps.waitlistLimit.refillMs)) / 1000,
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
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) || isWaitlistRoute(c.req.path))
      return next();
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
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
      key: JSON.stringify([principal.id, key.data]),
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
