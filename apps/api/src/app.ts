import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { parseFundId } from "@yen/shared";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  createFundRoute,
  type fundSchema,
  getFundRoute,
  healthRoute,
  meRoute,
  openapiRoute,
  openapiSchema,
  principalSchema,
  readyRoute,
} from "./contract.js";
import { type ApiEnv, type AppDependencies, defaultDependencies } from "./dependencies.js";
import { ApiError, errorBody, errorStatus } from "./errors.js";
import { idempotency, rateLimit, requestContext, requireAuth } from "./middleware.js";

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const deps = { ...defaultDependencies(), ...overrides };
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError(
          "validation_failed",
          result.error.issues.map((issue) => ({
            path: [
              result.target,
              ...issue.path.map((part) => (typeof part === "number" ? part : String(part))),
            ],
            message: issue.message,
          })),
        );
      }
    },
  });
  app.use("*", requestContext(deps));
  if (deps.corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: deps.corsOrigins,
        allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
        exposeHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replayed"],
      }),
    );
  }
  app.onError((error, c) => {
    const failure =
      error instanceof ApiError
        ? error
        : error instanceof HTTPException && error.status === 400
          ? new ApiError("validation_failed")
          : new ApiError("internal");
    return c.json(errorBody(failure, c.get("requestId")), errorStatus[failure.code]);
  });
  app.notFound((c) =>
    c.json(errorBody(new ApiError("not_found"), c.get("requestId")), errorStatus.not_found),
  );
  app.use("/v1/*", rateLimit(deps), idempotency(deps));
  app.use("/v1/me", requireAuth);
  app.use("/v1/funds/*", requireAuth);

  const funds = new Map<string, { owner: string; fund: z.infer<typeof fundSchema> }>();
  app.openapi(healthRoute, (c) => c.json({ status: "ok" }, 200));
  app.openapi(readyRoute, async (c) => {
    if (!(await deps.readiness())) throw new ApiError("internal");
    return c.json({ status: "ok" }, 200);
  });
  app.openapi(meRoute, (c) => c.json(principalSchema.parse(c.get("principal")), 200));
  app.openapi(createFundRoute, (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const id = parseFundId(deps.idGenerator());
    if (!id.ok) throw new ApiError("internal");
    const fund = {
      ...c.req.valid("json"),
      id: id.value,
      createdAt: new Date(deps.clock()).toISOString(),
    };
    funds.set(id.value, { owner: principal.id, fund });
    return c.json(fund, 201);
  });
  app.openapi(getFundRoute, (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry || entry.owner !== c.get("principal")?.id) throw new ApiError("not_found");
    return c.json(entry.fund, 200);
  });
  app.openapi(openapiRoute, (c) => c.json(openapiSchema.parse(openApiDocument(app)), 200));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Reserved for YEN-22. Only injected principals authenticate today.",
  });
  return app;
}

export function openApiDocument(
  app = createApp(),
): ReturnType<OpenAPIHono<ApiEnv>["getOpenAPI31Document"]> {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Yen API",
      version: "1.0.0",
      description:
        "YEN-15 foundation contract. Funds are explicit in-memory stubs. Paise uses decimal strings.",
    },
  });
}
