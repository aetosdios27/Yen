import { createServer, request as httpRequest } from "node:http";

/**
 * Adds CORS headers in front of the real API for browser-driven E2E journeys.
 *
 * The production API ships no CORS headers because deploys terminate both apps
 * behind one origin. Local E2E serves the browser and the API on different
 * ports, so this edge adds the same safe headers the stub API uses and forwards
 * everything else byte for byte. The API still sees the browser cookies,
 * headers and bodies unchanged.
 */
const port = Number(process.env.E2E_PROXY_PORT ?? 3940);
const apiPort = Number(process.env.E2E_API_PORT ?? 3939);
const apiHost = "127.0.0.1";
const webOrigin = `http://localhost:${Number(process.env.E2E_WEB_PORT ?? 3137)}`;

const corsHeaders = {
  "access-control-allow-origin": webOrigin,
  "access-control-allow-credentials": "true",
  "access-control-allow-headers":
    "content-type, idempotency-key, authorization, x-request-id, x-approval-pin, x-approval-token, traceparent, tracestate",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

const forwardedResponseHeaders = [
  "cache-control",
  "content-type",
  "etag",
  "location",
  "retry-after",
  "set-cookie",
  "warning",
  "x-yen-data-as-of",
];

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method === "GET" && new URL(request.url ?? "/", "http://x").pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json", ...corsHeaders });
    response.end(JSON.stringify({ status: "ok", proxy: true, target: `127.0.0.1:${apiPort}` }));
    return;
  }

  const headers = { ...request.headers };
  delete headers.origin;
  delete headers.referer;
  const upstream = httpRequest({
    host: apiHost,
    port: apiPort,
    path: request.url,
    method: request.method,
    headers,
  });

  upstream.on("response", (upstreamResponse) => {
    for (const name of forwardedResponseHeaders) {
      const value = upstreamResponse.headers[name];
      if (value !== undefined) {
        response.setHeader(name, value);
      }
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, corsHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json", ...corsHeaders });
    }
    response.end(JSON.stringify({ error: { code: "proxy_unreachable" } }));
  });

  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`e2e cors proxy on http://127.0.0.1:${port} -> 127.0.0.1:${apiPort}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
