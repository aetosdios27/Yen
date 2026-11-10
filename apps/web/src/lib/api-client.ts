import { createYenClient, type YenClient } from "@yen/api-client";
import { browserApiFetch } from "@yen/shared/browser-tracing";

let defaultClient: YenClient | null = null;

function tracedFetch(input: Request): Promise<Response> {
  return browserApiFetch(input, process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT);
}

export function getApiClient(baseUrl?: string): YenClient {
  if (baseUrl) {
    return createYenClient({
      baseUrl,
      credentials: "include",
      fetch: tracedFetch,
    });
  }

  if (!defaultClient) {
    const resolvedUrl =
      typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL
        ? process.env.NEXT_PUBLIC_API_URL
        : "http://localhost:3001";

    defaultClient = createYenClient({
      baseUrl: resolvedUrl,
      credentials: "include",
      fetch: tracedFetch,
    });
  }

  return defaultClient;
}

export function setApiClient(client: YenClient | null): void {
  defaultClient = client;
}

export type { YenClient };
