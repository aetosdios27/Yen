import type { Server } from "node:http";
import type { Sql } from "@yen/db";
import type { Logger } from "./logging.js";

export interface ServerLifecycleOptions {
  readonly server: Server;
  readonly sql?: Sql | undefined;
  readonly getInFlight: () => number;
  readonly shutdownTimeoutMs: number;
  readonly drainPollMs?: number;
  readonly logger?: Logger;
  readonly onShutdownComplete?: () => void;
}

export interface ServerLifecycle {
  readonly isShuttingDown: boolean;
  shutdown(signal?: string): Promise<void>;
}

// Graceful shutdown lifecycle manager:
// 1. Stop accepting new connections via server.close()
//    Primary doc: https://nodejs.org/api/net.html#serverclosecallback
// 2. Close idle keep-alive sockets via server.closeIdleConnections()
//    Primary doc: https://nodejs.org/api/http.html#servercloseidleconnections
// 3. Drain in-flight requests until count is zero, bounded by shutdownTimeoutMs
// 4. Force-close any lingering sockets via server.closeAllConnections() only if deadline expires
//    Primary doc: https://nodejs.org/api/http.html#servercloseallconnections
// 5. Close database connection pool via sql.end({ timeout })
//    Primary doc: https://github.com/porsager/postgres#teardown--cleanup
export function createServerLifecycle(options: ServerLifecycleOptions): ServerLifecycle {
  let isShuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = async (_signal?: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    isShuttingDown = true;

    shutdownPromise = (async () => {
      // 1. Stop accepting new connections
      const serverClosed = new Promise<void>((resolve) => {
        options.server.close(() => {
          resolve();
        });
      });

      // 2. Immediately close idle keep-alive sockets
      if (typeof options.server.closeIdleConnections === "function") {
        options.server.closeIdleConnections();
      }

      // 3. Drain in-flight requests (Guard: drain wait)
      const drainDeadline = Date.now() + options.shutdownTimeoutMs;
      const pollMs = options.drainPollMs ?? 25;
      while (options.getInFlight() > 0 && Date.now() < drainDeadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      // 4. If deadline passed and in-flight requests remain, force-close them
      if (Date.now() >= drainDeadline && typeof options.server.closeAllConnections === "function") {
        options.server.closeAllConnections();
      }

      // After draining active requests, close any newly idle keep-alive connections
      if (typeof options.server.closeIdleConnections === "function") {
        options.server.closeIdleConnections();
      }

      // Wait for server to close, bounded by remaining shutdown time
      const remainingTime = Math.max(100, drainDeadline - Date.now());
      let closeTimeout: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        closeTimeout = setTimeout(() => {
          if (typeof options.server.closeAllConnections === "function") {
            options.server.closeAllConnections();
          }
          resolve();
        }, remainingTime);
      });

      try {
        await Promise.race([serverClosed, timeoutPromise]);
      } finally {
        if (closeTimeout) clearTimeout(closeTimeout);
      }

      // 5. Close database pool with bounded timeout
      if (options.sql) {
        const poolTimeoutSec = Math.max(1, Math.floor(options.shutdownTimeoutMs / 1000));
        try {
          await options.sql.end({ timeout: poolTimeoutSec });
        } catch {
          // Handled quietly during shutdown
        }
      }

      options.onShutdownComplete?.();
    })();

    return shutdownPromise;
  };

  return {
    get isShuttingDown() {
      return isShuttingDown;
    },
    shutdown,
  };
}
