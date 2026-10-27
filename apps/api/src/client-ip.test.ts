import { expect, it } from "vitest";
import { clientIp, createClientIpResolver, parseRfc7239Forwarded } from "./client-ip.js";

it("selects only the configured address from the right", () => {
  const socket = "127.0.0.1";
  for (const prefix of ["", "bad, ", "anything !, more garbage, ", "8.8.8.8, "]) {
    expect(clientIp(socket, `${prefix}203.0.113.7`, 1)).toBe("203.0.113.7");
  }
  expect(clientIp(socket, "bad, 1.2.3.4, 10.0.0.1", 2)).toBe("1.2.3.4");
  expect(clientIp(socket, "bad, 1.2.3.4, 10.0.0.1, 10.0.0.2", 3)).toBe("1.2.3.4");
  expect(clientIp(socket, "bad, 10.0.0.1", 2)).toBe(socket);
  expect(clientIp(socket, "1.2.3.4", 2)).toBe(socket);
  expect(clientIp(socket, "1.2.3.4,", 1)).toBe(socket);
  expect(clientIp(socket, "1.2.3.4", 0)).toBe(socket);
});

it("normalizes selected addresses and repeated header lines", () => {
  const headers = new Headers();
  headers.append("x-forwarded-for", "garbage");
  headers.append("x-forwarded-for", " 203.0.113.7:1234 ");
  expect(clientIp("socket", headers.get("x-forwarded-for") ?? undefined, 1)).toBe("203.0.113.7");
  for (const address of ["::1", "[::1]:123", "0:0:0:0:0:0:0:1"]) {
    expect(clientIp("socket", address, 1)).toBe("::1");
  }
  for (const address of ["2001:db8::1", "[2001:0db8:0:0:0:0:0:1]:443"]) {
    expect(clientIp("socket", address, 1)).toBe("2001:db8::1");
  }
});

it.each(["fe80::1%eth0", "", "x".repeat(10000), "::1\0", "[::1", "garbage:[::1]%eth0"])(
  "falls back for malformed forwarded address %s",
  (address) => {
    expect(clientIp("127.0.0.1", address, 1)).toBe("127.0.0.1");
  },
);

it("parses RFC 7239 Forwarded header according to the specification", () => {
  // RFC 7239 Section 4 example
  const header = 'for=192.0.2.43, for="[2001:db8:cafe::17]:4711"';
  expect(parseRfc7239Forwarded(header, 1)).toBe("2001:db8:cafe::17");
  expect(parseRfc7239Forwarded(header, 2)).toBe("192.0.2.43");
  expect(parseRfc7239Forwarded(header, 3)).toBeUndefined();
  expect(parseRfc7239Forwarded(header, 0)).toBeUndefined();

  // With other parameters like proto, by
  const complex = 'for=1.2.3.4;proto=https;by=10.0.0.1, for="203.0.113.195";proto=http';
  expect(parseRfc7239Forwarded(complex, 1)).toBe("203.0.113.195");
  expect(parseRfc7239Forwarded(complex, 2)).toBe("1.2.3.4");

  // Malformed or unknown obfuscated identifiers fall back to undefined
  expect(parseRfc7239Forwarded("for=unknown", 1)).toBeUndefined();
  expect(parseRfc7239Forwarded("for=_obf123", 1)).toBeUndefined();
  expect(parseRfc7239Forwarded("by=10.0.0.1", 1)).toBeUndefined();
});

it("ignores both XFF and RFC 7239 when trusted proxy hops is 0", () => {
  const socket = "198.51.100.5";
  const xff = "203.0.113.195";
  const rfc = 'for="192.0.2.1"';

  expect(clientIp(socket, xff, 0)).toBe(socket);
  expect(clientIp(socket, rfc, 0, "forwarded")).toBe(socket);
  expect(clientIp(socket, xff, 0, "forwarded")).toBe(socket);

  const resolver = createClientIpResolver({ trustedHops: 0 });
  const mockContext = {
    req: {
      header: (name: string) => {
        if (name === "x-forwarded-for") return "1.1.1.1";
        if (name === "forwarded") return 'for="2.2.2.2"';
        return undefined;
      },
    },
  } as unknown as Parameters<typeof resolver>[0];
  expect(resolver(mockContext)).toBe("unknown");
});

function contextWith(headers: Record<string, string>) {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Parameters<ReturnType<typeof createClientIpResolver>>[0];
}

it("keeps quoted commas, semicolons and escaped quotes inside one Forwarded element", () => {
  // Unquoted splitting would leave `b"` as the rightmost element and fall back to the socket.
  expect(parseRfc7239Forwarded('for=198.51.100.5;ext="a,b"', 1)).toBe("198.51.100.5");
  expect(parseRfc7239Forwarded('for=198.51.100.5;ext="a\\"b,c;d"', 1)).toBe("198.51.100.5");
  expect(parseRfc7239Forwarded('for="[2001:db8:cafe::17]:4711";ext="x;y"', 1)).toBe(
    "2001:db8:cafe::17",
  );
});

it("treats obfuscated, unknown and non-IP identifiers as unusable and falls back to the socket", () => {
  const socket = "203.0.113.10";
  for (const header of [
    "for=_hidden",
    'for="_hidden:8080"',
    "for=unknown",
    'for="unknown"',
    "for=example.com",
    'for="example.com:443"',
  ]) {
    expect(parseRfc7239Forwarded(header, 1)).toBeUndefined();
    expect(clientIp(socket, header, 1, "forwarded")).toBe(socket);
  }
});

it("trusts X-Forwarded-For by default even when the client also sends Forwarded", () => {
  // Regression: a proxy that passes Forwarded through must not let the client choose the bucket.
  const resolver = createClientIpResolver({ trustedHops: 1 });
  expect(
    resolver(contextWith({ "x-forwarded-for": "198.51.100.1", forwarded: "for=203.0.113.99" })),
  ).toBe("198.51.100.1");
});

it("honors an explicit trustedHeader of x-forwarded-for and ignores Forwarded", () => {
  const resolver = createClientIpResolver({ trustedHops: 1, trustedHeader: "x-forwarded-for" });
  expect(
    resolver(contextWith({ "x-forwarded-for": "198.51.100.1", forwarded: "for=203.0.113.99" })),
  ).toBe("198.51.100.1");
});

it("createClientIpResolver never calls req.header when trustedHops is 0", () => {
  let headerCalled = false;
  const resolver = createClientIpResolver({ trustedHops: 0, trustedHeader: "x-forwarded-for" });
  const mockContext = {
    req: {
      header: () => {
        headerCalled = true;
        return "1.2.3.4";
      },
    },
  } as unknown as Parameters<typeof resolver>[0];
  expect(resolver(mockContext)).toBe("unknown");
  expect(headerCalled).toBe(false);
});

it("createClientIpResolver reads only forwarded when trustedHeader is forwarded", () => {
  const readHeaders: string[] = [];
  const resolver = createClientIpResolver({ trustedHops: 1, trustedHeader: "forwarded" });
  const mockContext = {
    req: {
      header: (name: string) => {
        readHeaders.push(name);
        if (name === "forwarded") return "for=198.51.100.5";
        return "203.0.113.1";
      },
    },
  } as unknown as Parameters<typeof resolver>[0];
  expect(resolver(mockContext)).toBe("198.51.100.5");
  expect(readHeaders).toEqual(["forwarded"]);
});

it("rejects malformed quoting before trusting a proxy-appended Forwarded element", () => {
  const socket = "192.0.2.10";
  const header = 'for=198.51.100.9;foo=" , for=203.0.113.5';
  expect(parseRfc7239Forwarded(header, 1)).toBeUndefined();
  expect(clientIp(socket, header, 1, "forwarded")).toBe(socket);
});
