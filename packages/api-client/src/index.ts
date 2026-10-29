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
export { createDeviceSignatureApi } from "./device-signature-api.js";
