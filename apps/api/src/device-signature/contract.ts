import { createRoute, z } from "@hono/zod-openapi";
import { errorEnvelope } from "../errors.js";

const security = [{ bearerAuth: [] }];
const responseHeaders = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
    required: true,
  },
} as const;
const retryAfterHeader = {
  schema: { type: "string", pattern: "^[1-9][0-9]*$" },
  description: "Seconds until retry",
} as const;
const protectedErrors = {
  400: {
    description: "Invalid request",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  401: {
    description: "Authentication required",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  403: {
    description: "Access denied",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  404: {
    description: "Resource not found",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  409: {
    description: "Resource conflict",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  429: {
    description: "Rate limit exceeded",
    headers: { ...responseHeaders, "retry-after": { ...retryAfterHeader, required: true } },
    content: { "application/json": { schema: errorEnvelope } },
  },
  500: {
    description: "Internal failure",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  503: {
    description: "Service unavailable",
    headers: { ...responseHeaders, "retry-after": { ...retryAfterHeader, required: true } },
    content: { "application/json": { schema: errorEnvelope } },
  },
  504: {
    description: "Gateway timeout",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
} as const;

const credentialDescriptor = z.object({
  id: z.string(),
  type: z.literal("public-key"),
  transports: z.array(z.string()).optional(),
});
const authenticatorSelection = z.object({
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
  requireResidentKey: z.boolean().optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
});
const registrationOptions = z
  .object({
    challenge: z.string(),
    rp: z.object({ id: z.string().optional(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
    pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number() })),
    timeout: z.number().optional(),
    excludeCredentials: z.array(credentialDescriptor).optional(),
    authenticatorSelection: authenticatorSelection.optional(),
    attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const assertionOptions = z
  .object({
    challenge: z.string(),
    rpId: z.string().optional(),
    timeout: z.number().optional(),
    allowCredentials: z.array(credentialDescriptor).optional(),
    userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type DeviceRegistrationOptionsResponse = z.infer<typeof registrationOptions>;
export type DeviceAssertionOptionsResponse = z.infer<typeof assertionOptions>;
const webAuthnResponse = z.record(z.string(), z.unknown());

export const deviceRegistrationOptionsRoute = createRoute({
  method: "post",
  path: "/v1/auth/device-credentials/registration/options",
  operationId: "createDeviceCredentialRegistrationOptions",
  tags: ["auth", "device-credentials"],
  security,
  description: "Creates a one-minute WebAuthn registration challenge for the signed-in user.",
  responses: {
    200: {
      description: "Registration options",
      headers: responseHeaders,
      content: { "application/json": { schema: registrationOptions } },
    },
    ...protectedErrors,
  },
});

export const deviceRegistrationVerifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/device-credentials/registration/verify",
  operationId: "registerDeviceCredential",
  tags: ["auth", "device-credentials"],
  security,
  description: "Registers a device credential after fresh Yen PIN verification.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              label: z.string().trim().min(1).max(80),
              pin: z.string().regex(/^\d{6}$/),
              response: webAuthnResponse,
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Credential registered",
      headers: responseHeaders,
      content: {
        "application/json": {
          schema: z.object({
            credentialId: z.string(),
            label: z.string(),
            createdAt: z.iso.datetime(),
            lastUsedAt: z.iso.datetime().nullable(),
            revokedAt: z.iso.datetime().nullable(),
          }),
        },
      },
    },
    ...protectedErrors,
  },
});

export const deviceCredentialListRoute = createRoute({
  method: "get",
  path: "/v1/auth/device-credentials",
  operationId: "listDeviceCredentials",
  tags: ["auth", "device-credentials"],
  security,
  description: "Lists the signed-in user's device credentials, including revoked entries.",
  responses: {
    200: {
      description: "Device credentials",
      headers: responseHeaders,
      content: {
        "application/json": {
          schema: z.object({
            credentials: z.array(
              z.object({
                credentialId: z.string(),
                label: z.string(),
                createdAt: z.iso.datetime(),
                lastUsedAt: z.iso.datetime().nullable(),
                revokedAt: z.iso.datetime().nullable(),
              }),
            ),
          }),
        },
      },
    },
    ...protectedErrors,
  },
});

export const deviceCredentialRevokeRoute = createRoute({
  method: "delete",
  path: "/v1/auth/device-credentials/{credentialId}",
  operationId: "revokeDeviceCredential",
  tags: ["auth", "device-credentials"],
  security,
  description: "Revokes one device credential owned by the signed-in user.",
  request: {
    params: z.object({ credentialId: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/) }),
  },
  responses: {
    200: {
      description: "Credential revoked",
      headers: responseHeaders,
      content: { "application/json": { schema: z.object({ status: z.literal("revoked") }) } },
    },
    ...protectedErrors,
  },
});

export const deviceAssertionOptionsRoute = createRoute({
  method: "post",
  path: "/v1/auth/device-signatures/options",
  operationId: "createDeviceSignatureOptions",
  tags: ["auth", "device-signatures"],
  security,
  description: "Creates a one-minute WebAuthn assertion challenge bound to an exact action hash.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ actionHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Assertion options",
      headers: responseHeaders,
      content: { "application/json": { schema: assertionOptions } },
    },
    ...protectedErrors,
  },
});

export const deviceAssertionVerifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/device-signatures/verify",
  operationId: "verifyDeviceSignature",
  tags: ["auth", "device-signatures"],
  security,
  description:
    "Verifies a device assertion and returns a one-use, 60-second proof bound to the action hash.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              actionHash: z.string().regex(/^[0-9a-f]{64}$/),
              response: webAuthnResponse,
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Device signature proof",
      headers: responseHeaders,
      content: {
        "application/json": {
          schema: z.object({ deviceProof: z.string().uuid(), expiresAt: z.iso.datetime() }),
        },
      },
    },
    ...protectedErrors,
  },
});
