import { createApp, devPolicy } from "@yen/api";
import { expect, it } from "vitest";
import {
  type BrowserAssertionResponse,
  type BrowserAttestationResponse,
  type BrowserPublicKeyCredential,
  buildCredentialCreationOptions,
  buildCredentialRequestOptions,
  computeActionHash,
  createDeviceSignatureApi,
  createYenClient,
  parseAssertionCredential,
  parseRegistrationCredential,
} from "./index.js";

function client() {
  const app = createApp({
    principal: { id: "00000000-0000-4000-8000-000000000001", role: "owner" },
    logger: { log: () => undefined },
    policy: devPolicy,
  });
  return createYenClient({
    baseUrl: "http://yen.test",
    fetch: async (request) => app.request(request),
  });
}

it("creates, reads, and replays a fund using the generated contract", async () => {
  const api = client();
  const options = {
    params: { header: { "Idempotency-Key": "frontend-create-fund" } },
    body: {
      name: "Festival",
      targetPaise: "9007199254740993",
      upiVpa: "festival@yenbank",
      upiPayeeName: "Festival Committee",
    },
  };
  const created = await api.POST("/v1/funds", options);
  expect(created.response.status).toBe(201);
  expect(created.data?.targetPaise).toBe("9007199254740993");
  if (!created.data) throw new Error("Expected created fund");
  const read = await api.GET("/v1/funds/{fundId}", {
    params: { path: { fundId: created.data.id } },
  });
  expect(read.data).toEqual(created.data);
  const replay = await api.POST("/v1/funds", options);
  expect(replay.data).toEqual(created.data);
  expect(replay.response.headers.get("idempotent-replayed")).toBe("true");
});

it("exposes typed errors and validation field paths", async () => {
  const api = client();
  const response = await api.POST("/v1/funds", {
    params: { header: { "Idempotency-Key": "invalid-input" } },
    body: {
      name: "",
      targetPaise: "-1",
      upiVpa: "festival@yenbank",
      upiPayeeName: "Festival Committee",
    },
  });
  expect(response.data).toBeUndefined();
  expect(response.error?.error.code).toBe("validation_failed");
  expect(response.error?.error.details?.[0]?.path).toEqual(["json", "name"]);
});

it("gets the mock principal with no network request", async () => {
  const response = await client().GET("/v1/me");
  expect(response.data?.id).toBe("00000000-0000-4000-8000-000000000001");
});

it("builds browser WebAuthn options from the API's base64url JSON form", () => {
  const creation = buildCredentialCreationOptions({
    challenge: "AQID",
    rp: { id: "yen.test", name: "Yen" },
    user: { id: "BAUG", name: "member", displayName: "Yen member" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ id: "Bwg", type: "public-key", transports: ["internal"] }],
    authenticatorSelection: { userVerification: "required" },
  });
  expect([...new Uint8Array(creation.challenge as ArrayBuffer)]).toEqual([1, 2, 3]);
  expect([...new Uint8Array(creation.user.id as ArrayBuffer)]).toEqual([4, 5, 6]);
  expect([...new Uint8Array(creation.excludeCredentials?.[0]?.id as ArrayBuffer)]).toEqual([7, 8]);

  const request = buildCredentialRequestOptions({
    challenge: "CQoL",
    rpId: "yen.test",
    allowCredentials: [{ id: "DA0", type: "public-key" }],
    userVerification: "required",
  });
  expect([...new Uint8Array(request.challenge as ArrayBuffer)]).toEqual([9, 10, 11]);
  expect([...new Uint8Array(request.allowCredentials?.[0]?.id as ArrayBuffer)]).toEqual([12, 13]);
});

it("wires device credential endpoints through the generated typed API client", async () => {
  const deviceApi = createDeviceSignatureApi(client());
  const response = await deviceApi.registrationOptions();
  expect(response.response.status).toBe(200);
  expect(typeof response.data?.challenge).toBe("string");
});

it("serializes registration and assertion credentials to WebAuthn JSON", () => {
  const rawId = Uint8Array.from([1, 2, 3]).buffer;
  const clientDataJSON = Uint8Array.from([4, 5]).buffer;
  const credential = {
    id: "AQID",
    rawId,
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON,
      attestationObject: Uint8Array.from([6, 7]).buffer,
      getTransports: () => ["internal"],
    },
  } as unknown as BrowserPublicKeyCredential<BrowserAttestationResponse>;
  expect(parseRegistrationCredential(credential)).toEqual({
    id: "AQID",
    rawId: "AQID",
    response: {
      clientDataJSON: "BAU",
      attestationObject: "Bgc",
      transports: ["internal"],
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    type: "public-key",
  });

  const assertion = {
    ...credential,
    response: {
      clientDataJSON,
      authenticatorData: Uint8Array.from([8]).buffer,
      signature: Uint8Array.from([9]).buffer,
      userHandle: null,
    },
  } as unknown as BrowserPublicKeyCredential<BrowserAssertionResponse>;
  expect(parseAssertionCredential(assertion).response).toEqual({
    clientDataJSON: "BAU",
    authenticatorData: "CA",
    signature: "CQ",
  });
});

it("computes canonical action hash invariant to key order", async () => {
  const hash1 = await computeActionHash({
    action: "expense:approve",
    fundId: "fund-123",
    amountPaise: "500000",
    payee: "vendor@upi",
  });
  const hash2 = await computeActionHash({
    payee: "vendor@upi",
    amountPaise: "500000",
    action: "expense:approve",
    fundId: "fund-123",
  });

  expect(hash1).toBe(hash2);
  expect(hash1).toMatch(/^[0-9a-f]{64}$/);
});
