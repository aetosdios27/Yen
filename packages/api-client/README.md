# Use the Yen API from the frontend

From the repository root, start the mock API:

```sh
pnpm install --frozen-lockfile
pnpm --filter @yen/api dev:mock
```

The server listens on `http://127.0.0.1:3001` with in-memory stores and principal
`00000000-0000-4000-8000-000000000001`. The command builds `@yen/shared` first.
`PORT` defaults to 3001. The mock refuses `NODE_ENV=production` and binds to loopback.
Browser origins `http://localhost:3000` and `http://127.0.0.1:3000` can call the mock,
including preflights for `Idempotency-Key`. The production entrypoint injects no principal
and enables no CORS origins by default.

Add `"@yen/api-client": "workspace:*"` to the consuming package, then build the client:

```sh
pnpm --filter @yen/api-client build
```

Use the server origin as `baseUrl`; generated paths already include `/v1`.

```ts
import { createYenClient } from "@yen/api-client";

const api = createYenClient({ baseUrl: "http://127.0.0.1:3001" });
const { data, error, response } = await api.POST("/v1/funds", {
  params: { header: { "Idempotency-Key": crypto.randomUUID() } },
  body: { name: "Festival", targetPaise: "9007199254740993" },
});

if (data) {
  const fund = await api.GET("/v1/funds/{fundId}", {
    params: { path: { fundId: data.id } },
  });
}
```

Keep the same idempotency key and exact request input when retrying an operation.
Inspect `error.error.code` on failure and `response.headers.get("retry-after")` for
rate limits or in-progress reservations. Money remains a decimal string throughout.
The API contract reference is [apps/api/README.md](../../apps/api/README.md).

After a deliberate contract change, regenerate and commit both files:

```sh
pnpm --filter @yen/api openapi:generate
pnpm --filter @yen/api-client generate
pnpm verify
```

The **OpenAPI diff** CI step checks the committed spec and generated types.
Both checks also run in their package tests under `pnpm verify`.
Turbo tracks the API spec as a client test input. Builds compile committed files
without generation or network access.

The client package pins TypeScript 5.9.3 because `openapi-typescript@7.13.0` requires
TypeScript 5's compiler API. The remaining packages keep the repository's compiler.
`src/index.test.ts` drives the real API through `openapi-fetch` using an injected
fetch function, with no socket or network dependency.
