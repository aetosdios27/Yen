import { expect, it } from "vitest";
import { clientIp } from "./client-ip.js";

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
