import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated.js";

export {
  type BrowserAssertionResponse,
  type BrowserAttestationResponse,
  type BrowserPublicKeyCredential,
  buildCredentialCreationOptions,
  buildCredentialRequestOptions,
  parseAssertionCredential,
  parseRegistrationCredential,
  type WebAuthnAssertionOptionsJSON,
  type WebAuthnRegistrationOptionsJSON,
} from "./device-webauthn.js";
export type { components, operations, paths } from "./generated.js";

export function createYenClient(options: ClientOptions & { baseUrl: string }) {
  return createClient<paths>(options);
}

export type YenApiClient = ReturnType<typeof createYenClient>;
export type YenClient = ReturnType<typeof createYenClient>;
export { createDeviceSignatureApi } from "./device-signature-api.js";

export async function computeActionHash(details: Record<string, unknown>): Promise<string> {
  const sortedKeys = Object.keys(details).sort();
  const canonicalObject: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonicalObject[key] = details[key];
  }
  const serialized = JSON.stringify(canonicalObject);
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
