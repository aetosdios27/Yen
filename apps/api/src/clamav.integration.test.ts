import { describe, expect, it } from "vitest";
import { ClamAvVirusScannerAdapter } from "./virus-scanner.js";

const enabled = process.env.CLAMAV_INTEGRATION === "1";
const host = process.env.CLAMAV_HOST ?? "127.0.0.1";
const port = Number(process.env.CLAMAV_PORT ?? "3310");

describe.skipIf(!enabled)(
  "real ClamAV container integration (set CLAMAV_INTEGRATION=1 to run)",
  () => {
    it("detects the EICAR test string through INSTREAM", async () => {
      const eicar = new TextEncoder().encode(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      );
      const result = await new ClamAvVirusScannerAdapter({
        host,
        port,
        timeoutMs: 30_000,
        maxSizeBytes: 1024,
      }).scan({ objectKey: "integration-test", data: eicar });
      expect(result.status).toBe("infected");
      if (result.status === "infected") expect(result.threatName).toMatch(/Eicar/i);
    }, 35_000);
  },
);
