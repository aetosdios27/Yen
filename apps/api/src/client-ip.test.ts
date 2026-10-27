import { expect, it } from "vitest";
import { clientIp } from "./client-ip.js";

it("trusts only the configured rightmost proxy hops", () => {
  expect(clientIp("127.0.0.1", "1.2.3.4, 10.0.0.1", 0)).toBe("127.0.0.1");
  expect(clientIp("127.0.0.1", "1.2.3.4, 10.0.0.1", 1)).toBe("10.0.0.1");
  expect(clientIp("127.0.0.1", "8.8.8.8, 1.2.3.4, 10.0.0.1", 2)).toBe("1.2.3.4");
  for (const header of [undefined, "bad, 10.0.0.1", "1.2.3.4,", "1.2.3.4"])
    expect(clientIp("127.0.0.1", header, 2)).toBe("127.0.0.1");
});
