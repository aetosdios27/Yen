import { createYenClient, type YenClient } from "@yen/api-client";

let defaultClient: YenClient | null = null;

export function getApiClient(baseUrl?: string): YenClient {
  if (baseUrl) {
    return createYenClient({
      baseUrl,
      credentials: "include",
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
    });
  }

  return defaultClient;
}

export function setApiClient(client: YenClient | null): void {
  defaultClient = client;
}

export type { YenClient };
