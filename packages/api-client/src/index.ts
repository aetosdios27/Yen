import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated.js";

export type { components, operations, paths } from "./generated.js";

export function createYenClient(options: ClientOptions & { baseUrl: string }) {
  return createClient<paths>(options);
}
