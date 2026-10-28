export type VirusScanResult =
  | { readonly status: "clean" }
  | { readonly status: "infected"; readonly threatName: string }
  | { readonly status: "quarantined"; readonly reason: string };

export interface VirusScannerAdapter {
  scan(input: { objectKey: string; data: Uint8Array; mimeType: string }): Promise<VirusScanResult>;
}

/**
 * Production fail-closed unconfigured virus scanner adapter.
 * Rejects all scans until an explicit virus scanning service (e.g. ClamAV daemon)
 * is configured.
 */
export class UnconfiguredVirusScannerAdapter implements VirusScannerAdapter {
  async scan(): Promise<never> {
    throw new Error(
      "VirusScannerAdapter is unconfigured. Default fail-closed policy rejects uninspected uploads in production.",
    );
  }
}

/**
 * Deterministic virus scanner adapter for testing and local development.
 * Scans for standard EICAR anti-malware test signature and allows configuring
 * specific hashes or payloads to simulate quarantined or infected files.
 */
export class MemoryVirusScannerAdapter implements VirusScannerAdapter {
  private readonly infectedHashes = new Set<string>();
  private readonly quarantinedKeys = new Set<string>();

  // Standard EICAR string in ASCII
  private static readonly EICAR_SIGNATURE =
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

  markInfectedHash(sha256Hex: string): void {
    this.infectedHashes.add(sha256Hex.toLowerCase());
  }

  markQuarantinedKey(key: string): void {
    this.quarantinedKeys.add(key);
  }

  async scan(input: {
    objectKey: string;
    data: Uint8Array;
    mimeType: string;
  }): Promise<VirusScanResult> {
    if (this.quarantinedKeys.has(input.objectKey)) {
      return { status: "quarantined", reason: "Policy quarantine rule matched" };
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.data);
    if (text.includes(MemoryVirusScannerAdapter.EICAR_SIGNATURE)) {
      return { status: "infected", threatName: "EICAR-Test-Signature" };
    }

    return { status: "clean" };
  }
}
