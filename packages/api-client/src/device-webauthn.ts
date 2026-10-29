export interface WebAuthnCredentialDescriptorJSON {
  readonly id: string;
  readonly type: "public-key";
  readonly transports?: readonly string[];
}

export interface BrowserCredentialDescriptor {
  type: "public-key";
  id: ArrayBuffer;
  transports?: string[];
}

export interface BrowserAuthenticatorSelection {
  authenticatorAttachment?: "platform" | "cross-platform";
  residentKey?: "discouraged" | "preferred" | "required";
  requireResidentKey?: boolean;
  userVerification?: "required" | "preferred" | "discouraged";
}

export interface BrowserCredentialCreationOptions {
  challenge: ArrayBuffer;
  rp: { id?: string; name: string };
  user: { id: ArrayBuffer; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: BrowserCredentialDescriptor[];
  authenticatorSelection?: BrowserAuthenticatorSelection;
  attestation?: "none" | "indirect" | "direct" | "enterprise";
}

export interface BrowserCredentialRequestOptions {
  challenge: ArrayBuffer;
  rpId?: string;
  timeout?: number;
  allowCredentials?: BrowserCredentialDescriptor[];
  userVerification?: "required" | "preferred" | "discouraged";
}

export interface BrowserPublicKeyCredential<TResponse> {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: "public-key";
  readonly authenticatorAttachment: "platform" | "cross-platform" | null;
  readonly response: TResponse;
  getClientExtensionResults(): Record<string, unknown>;
}

export interface BrowserAttestationResponse {
  readonly clientDataJSON: ArrayBuffer;
  readonly attestationObject: ArrayBuffer;
  getTransports?(): string[];
}

export interface BrowserAssertionResponse {
  readonly clientDataJSON: ArrayBuffer;
  readonly authenticatorData: ArrayBuffer;
  readonly signature: ArrayBuffer;
  readonly userHandle: ArrayBuffer | null;
}

export interface WebAuthnRegistrationOptionsJSON {
  readonly challenge: string;
  readonly rp: { readonly id?: string; readonly name: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly pubKeyCredParams: readonly { readonly type: "public-key"; readonly alg: number }[];
  readonly timeout?: number;
  readonly excludeCredentials?: readonly WebAuthnCredentialDescriptorJSON[];
  readonly authenticatorSelection?: BrowserAuthenticatorSelection;
  readonly attestation?: "none" | "indirect" | "direct" | "enterprise";
}

export interface WebAuthnAssertionOptionsJSON {
  readonly challenge: string;
  readonly rpId?: string;
  readonly timeout?: number;
  readonly allowCredentials?: readonly WebAuthnCredentialDescriptorJSON[];
  readonly userVerification?: "required" | "preferred" | "discouraged";
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function buildCredentialCreationOptions(
  options: WebAuthnRegistrationOptionsJSON,
): BrowserCredentialCreationOptions {
  return {
    challenge: asArrayBuffer(decodeBase64Url(options.challenge)),
    rp: options.rp,
    user: { ...options.user, id: asArrayBuffer(decodeBase64Url(options.user.id)) },
    pubKeyCredParams: [...options.pubKeyCredParams],
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.excludeCredentials === undefined
      ? {}
      : {
          excludeCredentials: options.excludeCredentials.map((credential) => ({
            id: asArrayBuffer(decodeBase64Url(credential.id)),
            type: credential.type,
            ...(credential.transports === undefined
              ? {}
              : { transports: [...credential.transports] }),
          })),
        }),
    ...(options.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: options.authenticatorSelection }),
    ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
  };
}

export function buildCredentialRequestOptions(
  options: WebAuthnAssertionOptionsJSON,
): BrowserCredentialRequestOptions {
  return {
    challenge: asArrayBuffer(decodeBase64Url(options.challenge)),
    ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.allowCredentials === undefined
      ? {}
      : {
          allowCredentials: options.allowCredentials.map((credential) => ({
            id: asArrayBuffer(decodeBase64Url(credential.id)),
            type: credential.type,
            ...(credential.transports === undefined
              ? {}
              : { transports: [...credential.transports] }),
          })),
        }),
    ...(options.userVerification === undefined
      ? {}
      : { userVerification: options.userVerification }),
  };
}

export function parseRegistrationCredential(
  credential: BrowserPublicKeyCredential<BrowserAttestationResponse> | null,
) {
  if (!credential) throw new Error("No device credential was returned");
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    type: credential.type,
  };
}

export function parseAssertionCredential(
  credential: BrowserPublicKeyCredential<BrowserAssertionResponse> | null,
) {
  if (!credential) throw new Error("No device assertion was returned");
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      ...(response.userHandle === null ? {} : { userHandle: encodeBase64Url(response.userHandle) }),
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    type: credential.type,
  };
}
