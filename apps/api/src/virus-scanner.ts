import { createConnection, type Socket } from "node:net";
import { ResilientCall } from "@yen/shared";

export type VirusScanResult =
  | { readonly status: "clean"; readonly scannerName: string; readonly signatureVersion: string }
  | {
      readonly status: "infected";
      readonly threatName: string;
      readonly scannerName: string;
      readonly signatureVersion: string;
    }
  | {
      readonly status: "quarantined";
      readonly reason: string;
      readonly scannerName: string;
      readonly signatureVersion?: string;
    };

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

export interface ClamAvOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maxSizeBytes: number;
}

/** ClamAV daemon adapter using its length-framed INSTREAM TCP protocol. */
export class ClamAvVirusScannerAdapter implements VirusScannerAdapter {
  readonly scannerName = "ClamAV";
  private readonly resilient: ResilientCall;
  constructor(private readonly options: ClamAvOptions) {
    this.resilient = new ResilientCall({
      timeoutMs: options.timeoutMs,
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
      failureThreshold: 3,
      resetAfterMs: 5_000,
    });
  }

  async scan(input: { objectKey: string; data: Uint8Array }): Promise<VirusScanResult> {
    if (input.data.byteLength > this.options.maxSizeBytes)
      return {
        status: "quarantined",
        reason: "File exceeds scanner size limit",
        scannerName: this.scannerName,
      };
    try {
      const signatureVersion = await this.resilient.run(() => this.command("VERSION"));
      if (!signatureVersion.startsWith("ClamAV "))
        throw new Error(`Unexpected clamd version reply: ${signatureVersion}`);
      const reply = await this.resilient.run(() => this.stream(input.data));
      if (reply.endsWith(" OK"))
        return { status: "clean", scannerName: this.scannerName, signatureVersion };
      const found = reply.match(/: (.+) FOUND$/);
      if (found?.[1])
        return {
          status: "infected",
          threatName: found[1],
          scannerName: this.scannerName,
          signatureVersion,
        };
      throw new Error(`Unexpected clamd reply: ${reply}`);
    } catch (error) {
      return {
        status: "quarantined",
        reason: error instanceof Error ? error.message : "ClamAV scan failed",
        scannerName: this.scannerName,
      };
    }
  }

  private request(write: (socket: Socket) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.options.host, port: this.options.port });
      let reply = "";
      let settled = false;
      const timer = setTimeout(
        () => socket.destroy(new Error("ClamAV scan timed out")),
        this.options.timeoutMs,
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(reply.replace(/[\r\n\0]+$/, ""));
      };
      socket.once("connect", () => write(socket));
      socket.on("data", (chunk) => {
        reply += chunk.toString("utf8");
        if (
          reply.includes("\n") ||
          reply.includes("\0") ||
          reply.endsWith(" OK") ||
          reply.endsWith(" FOUND")
        )
          finish();
      });
      socket.once("error", (error) => finish(error));
      socket.once("close", () => {
        if (!reply) finish(new Error("ClamAV closed connection without a reply"));
      });
    });
  }

  private command(command: string) {
    return this.request((socket) => socket.end(`${command}\n`));
  }

  private stream(data: Uint8Array) {
    return this.request((socket) => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < data.length; offset += 64 * 1024) {
        const chunk = data.subarray(offset, Math.min(offset + 64 * 1024, data.length));
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      const end = Buffer.alloc(4);
      socket.end(end);
    });
  }
}
