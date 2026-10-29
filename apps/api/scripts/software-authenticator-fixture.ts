import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const encodeHead = (major: number, value: number): Buffer => {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  if (value < 65_536) {
    const output = Buffer.alloc(3);
    output[0] = (major << 5) | 25;
    output.writeUInt16BE(value, 1);
    return output;
  }
  const output = Buffer.alloc(5);
  output[0] = (major << 5) | 26;
  output.writeUInt32BE(value, 1);
  return output;
};

function encodeCbor(value: unknown): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? encodeHead(0, value) : encodeHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const data = Buffer.from(value, "utf8");
    return Buffer.concat([encodeHead(3, data.length), data]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const data = Buffer.from(value);
    return Buffer.concat([encodeHead(2, data.length), data]);
  }
  if (value instanceof Map) {
    const entries = [...value.entries()];
    return Buffer.concat([
      encodeHead(5, entries.length),
      ...entries.flatMap(([key, entry]) => [encodeCbor(key), encodeCbor(entry)]),
    ]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([encodeHead(4, value.length), ...value.map(encodeCbor)]);
  }
  throw new TypeError("Unsupported software authenticator CBOR value");
}

function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
}

function authenticatorData(rpId: string, flags: number, counter: number) {
  const header = Buffer.alloc(37);
  createHash("sha256").update(rpId, "utf8").digest().copy(header, 0);
  header[32] = flags;
  header.writeUInt32BE(counter, 33);
  return header;
}

export function createSoftwareAuthenticator(rpId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Generated software key has no EC coordinates");
  const credentialBytes = randomBytes(32);
  const credentialId = credentialBytes.toString("base64url");
  const coseKey = encodeCbor(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]),
  );

  return {
    credentialId,
    registration(challenge: string, origin: string): RegistrationResponseJSON {
      const attestedData = Buffer.alloc(55 + credentialBytes.length + coseKey.length);
      authenticatorData(rpId, 0x45, 0).copy(attestedData, 0);
      // A zero AAGUID keeps this none-attestation fixture free of device identifiers.
      credentialBytes.copy(attestedData, 55);
      attestedData.writeUInt16BE(credentialBytes.length, 53);
      coseKey.copy(attestedData, 55 + credentialBytes.length);
      const attestationObject = encodeCbor(
        new Map<unknown, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", attestedData],
        ]),
      );
      const clientDataJSON = clientData("webauthn.create", challenge, origin);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          attestationObject: attestationObject.toString("base64url"),
          transports: ["internal"],
        },
        clientExtensionResults: {},
      };
    },
    assertion(
      challenge: string,
      origin: string,
      counter: number,
      assertedRpId = rpId,
    ): AuthenticationResponseJSON {
      const clientDataJSON = clientData("webauthn.get", challenge, origin);
      const authData = authenticatorData(assertedRpId, 0x05, counter);
      const clientDataHash = createHash("sha256").update(clientDataJSON).digest();
      const signature = sign("sha256", Buffer.concat([authData, clientDataHash]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
}
