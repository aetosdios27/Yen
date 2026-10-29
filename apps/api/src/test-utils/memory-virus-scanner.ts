import type { VirusScannerAdapter, VirusScanResult } from "../virus-scanner.js";

/** Test double that recognizes only the EICAR test fixture; it is not a malware scanner. */
export class MemoryVirusScannerAdapter implements VirusScannerAdapter {
  private readonly quarantinedKeys = new Set<string>();

  private static readonly EICAR_SIGNATURE =
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

  markQuarantinedKey(key: string): void {
    this.quarantinedKeys.add(key);
  }

  async scan(input: {
    objectKey: string;
    data: Uint8Array;
    mimeType: string;
  }): Promise<VirusScanResult> {
    if (this.quarantinedKeys.has(input.objectKey)) {
      return {
        status: "quarantined",
        reason: "Test quarantine rule matched",
        scannerName: "EICAR test double",
      };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.data);
    if (text.includes(MemoryVirusScannerAdapter.EICAR_SIGNATURE)) {
      return {
        status: "infected",
        threatName: "EICAR-Test-Signature",
        scannerName: "EICAR test double",
        signatureVersion: "fixture",
      };
    }
    return { status: "clean", scannerName: "EICAR test double", signatureVersion: "fixture" };
  }
}
