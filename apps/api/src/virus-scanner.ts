export type VirusScanResult =
  | { readonly status: "clean" }
  | { readonly status: "infected"; readonly threatName: string }
  | { readonly status: "quarantined"; readonly reason: string };

export interface VirusScannerAdapter {
  scan(input: { objectKey: string; data: Uint8Array; mimeType: string }): Promise<VirusScanResult>;
}

/**
 * Default adapter. No real malware scanner is integrated; uploads fail closed.
 */
export class UnconfiguredVirusScannerAdapter implements VirusScannerAdapter {
  async scan(): Promise<never> {
    throw new Error(
      "No real malware scanner is integrated. Upload rejected because no scanner is configured.",
    );
  }
}
