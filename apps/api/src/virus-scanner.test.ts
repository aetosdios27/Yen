import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClamAvVirusScannerAdapter, LocalDemoVirusScannerAdapter } from "./virus-scanner.js";

const servers: Array<{
  readonly server: Server;
  readonly sockets: Set<import("node:net").Socket>;
}> = [];
async function fakeClamd(reply: string | null = "stream: OK\0") {
  let streamed = Buffer.alloc(0);
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let input = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      if (input.subarray(0, 10).toString() === "VERSION\n") {
        socket.end("ClamAV 1.4.1/27900\n");
      } else if (input.subarray(0, 10).toString("binary").startsWith("zINSTREAM\0")) {
        streamed = input;
        if (input.length >= 4 && input.subarray(-4).equals(Buffer.alloc(4)) && reply !== null)
          socket.end(reply);
      }
    });
  });
  servers.push({ server, sockets });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake clamd did not bind TCP port");
  return {
    host: "127.0.0.1",
    port: address.port,
    get streamed() {
      return streamed;
    },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ server, sockets }) =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("ClamAV INSTREAM adapter", () => {
  it("streams data and returns clean with the daemon database version", async () => {
    const daemon = await fakeClamd();
    const result = await new ClamAvVirusScannerAdapter({
      ...daemon,
      timeoutMs: 500,
      maxSizeBytes: 1024,
    }).scan({ objectKey: "opaque", data: new Uint8Array([1, 2, 3]) });
    expect(result).toEqual({
      status: "clean",
      scannerName: "ClamAV",
      signatureVersion: "ClamAV 1.4.1/27900",
    });
    expect(daemon.streamed.includes(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("returns infected with ClamAV threat name", async () => {
    const daemon = await fakeClamd("stream: Eicar-Test-Signature FOUND\0");
    await expect(
      new ClamAvVirusScannerAdapter({ ...daemon, timeoutMs: 500, maxSizeBytes: 1024 }).scan({
        objectKey: "opaque",
        data: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({
      status: "infected",
      threatName: "Eicar-Test-Signature",
      signatureVersion: "ClamAV 1.4.1/27900",
    });
  });

  it("quarantines files above its configured maximum without connecting", async () => {
    const result = await new ClamAvVirusScannerAdapter({
      host: "127.0.0.1",
      port: 1,
      timeoutMs: 100,
      maxSizeBytes: 1,
    }).scan({ objectKey: "opaque", data: new Uint8Array(2) });
    expect(result).toMatchObject({
      status: "quarantined",
      reason: "File exceeds scanner size limit",
    });
  });

  it("quarantines a daemon timeout", async () => {
    const daemon = await fakeClamd(null);
    const result = await new ClamAvVirusScannerAdapter({
      ...daemon,
      timeoutMs: 100,
      maxSizeBytes: 1024,
    }).scan({ objectKey: "opaque", data: new Uint8Array([1]) });
    expect(result).toMatchObject({ status: "quarantined", reason: "ClamAV scan timed out" });
  });

  it("quarantines an invalid daemon reply", async () => {
    const daemon = await fakeClamd("nonsense\0");
    const result = await new ClamAvVirusScannerAdapter({
      ...daemon,
      timeoutMs: 500,
      maxSizeBytes: 1024,
    }).scan({ objectKey: "opaque", data: new Uint8Array([1]) });
    expect(result).toMatchObject({
      status: "quarantined",
      reason: "Unexpected clamd reply: nonsense",
    });
  });

  it("quarantines a refused connection", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not reserve port");
    const port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await new ClamAvVirusScannerAdapter({
      host: "127.0.0.1",
      port,
      timeoutMs: 500,
      maxSizeBytes: 1024,
    }).scan({ objectKey: "opaque", data: new Uint8Array([1]) });
    expect(result.status).toBe("quarantined");
  });
});

describe("Local demo scanner adapter", () => {
  function withNodeEnv(value: string | undefined, run: () => void) {
    const original = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    try {
      run();
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  }

  it("reports clean with a demo signature version and warns on every scan", async () => {
    const warnings: string[] = [];
    const adapter = new LocalDemoVirusScannerAdapter((message) => warnings.push(message));
    const first = await adapter.scan({
      objectKey: "funds/x/evidence/1",
      data: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    });
    const second = await adapter.scan({
      objectKey: "funds/x/evidence/2",
      data: new Uint8Array([4]),
      mimeType: "image/jpeg",
    });
    expect(first).toEqual({
      status: "clean",
      scannerName: "LocalDemoScanner",
      signatureVersion: "local-demo",
    });
    expect(second).toEqual(first);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("funds/x/evidence/1");
    expect(warnings[0]).toContain("CLAMAV_HOST");
  });

  it("refuses construction in production", () => {
    withNodeEnv("production", () => {
      expect(() => new LocalDemoVirusScannerAdapter()).toThrow(
        "The local demo malware scanner is not allowed in production",
      );
    });
  });

  it("constructs outside production", () => {
    withNodeEnv("development", () => {
      expect(new LocalDemoVirusScannerAdapter()).toBeInstanceOf(LocalDemoVirusScannerAdapter);
    });
    withNodeEnv(undefined, () => {
      expect(new LocalDemoVirusScannerAdapter()).toBeInstanceOf(LocalDemoVirusScannerAdapter);
    });
  });
});
