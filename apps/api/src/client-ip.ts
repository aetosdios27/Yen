import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { ApiEnv } from "./dependencies.js";

export type TrustedProxyHeader = "x-forwarded-for" | "forwarded";

function normalizeIpAddress(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  const ipv4WithPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(trimmed);
  const address = bracketed?.[1] ?? ipv4WithPort?.[1] ?? trimmed;
  const version = isIP(address);
  if (version === 4) return address;
  if (version === 6) {
    try {
      return new URL(`http://[${address}]/`).hostname.slice(1, -1);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Splits a header string on a delimiter ("," or ";") only when outside double-quoted strings,
 * honoring backslash escapes per RFC 7230 Section 3.2.6.
 */
function splitOutsideQuotes(input: string, delimiter: "," | ";"): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      if (inQuotes) {
        escapeNext = true;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Parses the standard Forwarded header according to RFC 7239 and RFC 7230 quoted-string rules.
 * RFC 7239 Section 4 (Forwarded): https://datatracker.ietf.org/doc/html/rfc7239#section-4
 * RFC 7230 Section 3.2.6: https://datatracker.ietf.org/doc/html/rfc7230#section-3.2.6
 * Parameter syntax: `Forwarded: for=192.0.2.60;proto=http;by=203.0.113.43, for="[2001:db8:cafe::17]:4711"`
 */
export function parseRfc7239Forwarded(forwarded: string, hops: number): string | undefined {
  if (hops <= 0 || !forwarded) return undefined;
  const elements = splitOutsideQuotes(forwarded, ",");
  if (elements.length < hops) return undefined;
  const selected = elements[elements.length - hops]?.trim();
  if (!selected) return undefined;

  const params = splitOutsideQuotes(selected, ";");
  for (const param of params) {
    const trimmed = param.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim().toLowerCase();
    if (name === "for") {
      let value = trimmed.slice(eqIdx + 1).trim();
      if (value.startsWith(`"`) && value.endsWith(`"`) && value.length >= 2) {
        value = value.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      if (value.toLowerCase() === "unknown" || value.startsWith("_")) {
        return undefined;
      }
      return normalizeIpAddress(value);
    }
  }
  return undefined;
}

/**
 * Resolves the client IP address from the direct socket address and the trusted header.
 * Safe by default: when hops === 0, all forwarded headers are ignored to prevent spoofing.
 *
 * Primary specifications:
 * - MDN X-Forwarded-For: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 * - RFC 7239 Forwarded: https://datatracker.ietf.org/doc/html/rfc7239
 */
export function clientIp(
  socket: string,
  rawHeader: string | undefined,
  hops: number,
  trustedHeader: TrustedProxyHeader = "x-forwarded-for",
): string {
  // Safe by default: if hops is 0, ALWAYS ignore forwarded headers and return the socket address.
  if (hops === 0 || !rawHeader) return socket;

  if (trustedHeader === "forwarded") {
    const parsed = parseRfc7239Forwarded(rawHeader, hops);
    return parsed ?? socket;
  }

  const addresses = rawHeader.split(",");
  if (addresses.length >= hops) {
    const selected = addresses[addresses.length - hops]?.trim();
    if (selected) {
      const parsed = normalizeIpAddress(selected);
      if (parsed) return parsed;
    }
  }

  return socket;
}

export interface ClientIpResolverOptions {
  readonly trustedHops: number;
  readonly trustedHeader?: TrustedProxyHeader;
}

/**
 * Creates an injectable client IP resolver for Hono context.
 * Safe by default: when trustedHops is 0, forwarded headers are completely ignored.
 * Only the configured trustedHeader is inspected when trustedHops > 0.
 */
export function createClientIpResolver(options: ClientIpResolverOptions) {
  const { trustedHops, trustedHeader = "x-forwarded-for" } = options;
  return (c: Context<ApiEnv>): string => {
    let socket = "unknown";
    try {
      socket = getConnInfo(c).remote.address ?? "unknown";
    } catch {
      socket = "unknown";
    }
    if (trustedHops === 0) return socket;

    const raw = c.req.header(trustedHeader);
    return clientIp(socket, raw, trustedHops, trustedHeader);
  };
}
