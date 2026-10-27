import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { ApiEnv } from "./dependencies.js";

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
 * Parses the standard Forwarded header according to RFC 7239.
 * RFC 7239 Section 4 (Forwarded): https://datatracker.ietf.org/doc/html/rfc7239#section-4
 * Parameter syntax: `Forwarded: for=192.0.2.60;proto=http;by=203.0.113.43, for="[2001:db8:cafe::17]:4711"`
 */
export function parseRfc7239Forwarded(forwarded: string, hops: number): string | undefined {
  if (hops <= 0 || !forwarded) return undefined;
  const elements = forwarded.split(",");
  if (elements.length < hops) return undefined;
  const selected = elements[elements.length - hops]?.trim();
  if (!selected) return undefined;

  const params = selected.split(";");
  for (const param of params) {
    const trimmed = param.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim().toLowerCase();
    if (name === "for") {
      let value = trimmed.slice(eqIdx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1);
      }
      return normalizeIpAddress(value);
    }
  }
  return undefined;
}

/**
 * Resolves the client IP address from the direct socket address and forwarded headers.
 * Safe by default: when hops === 0, all forwarded headers are ignored to prevent spoofing.
 *
 * Primary specifications:
 * - MDN X-Forwarded-For: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 * - RFC 7239 Forwarded: https://datatracker.ietf.org/doc/html/rfc7239
 */
export function clientIp(
  socket: string,
  forwarded: string | undefined,
  hops: number,
  rfcForwarded?: string | undefined,
): string {
  // Safe by default: if hops is 0, ALWAYS ignore forwarded headers and return the socket address.
  if (hops === 0) return socket;

  if (rfcForwarded) {
    const parsed = parseRfc7239Forwarded(rfcForwarded, hops);
    if (parsed) return parsed;
  }

  if (forwarded) {
    const addresses = forwarded.split(",");
    if (addresses.length >= hops) {
      const selected = addresses[addresses.length - hops]?.trim();
      if (selected) {
        const parsed = normalizeIpAddress(selected);
        if (parsed) return parsed;
      }
    }
  }

  return socket;
}

/**
 * Creates an injectable client IP resolver for Hono context.
 * Safe by default: when trustedHops is 0, forwarded headers are completely ignored.
 */
export function createClientIpResolver(options: { trustedHops: number }) {
  const { trustedHops } = options;
  return (c: Context<ApiEnv>): string => {
    let socket = "unknown";
    try {
      socket = getConnInfo(c).remote.address ?? "unknown";
    } catch {
      socket = "unknown";
    }
    if (trustedHops === 0) return socket;

    const xff = c.req.header("x-forwarded-for");
    const forwarded = c.req.header("forwarded");
    return clientIp(socket, xff, trustedHops, forwarded);
  };
}
