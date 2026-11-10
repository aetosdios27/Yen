import type { CDPSession, Page } from "@playwright/test";

/**
 * Chrome DevTools Protocol virtual authenticator control for WebAuthn tests.
 * Chromium only: Firefox and WebKit have no CDP WebAuthn domain.
 */
export interface VirtualAuthenticator {
  readonly cdp: CDPSession;
  readonly authenticatorId: string;
}

export async function enableVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

export async function removeVirtualAuthenticator(
  authenticator: VirtualAuthenticator,
): Promise<void> {
  await authenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
  await authenticator.cdp.detach();
}

export function setHardwareCpuThrottling(page: Page, rate: number): Promise<void> {
  return withCdp(page, (cdp) => cdp.send("Emulation.setCPUThrottlingRate", { rate }));
}

export function setSlowNetworkConditions(
  page: Page,
  conditions: { downloadThroughput: number; uploadThroughput: number; latency: number },
): Promise<void> {
  return withCdp(page, (cdp) =>
    cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: conditions.latency,
      downloadThroughput: conditions.downloadThroughput,
      uploadThroughput: conditions.uploadThroughput,
    }),
  );
}

async function withCdp(page: Page, run: (cdp: CDPSession) => Promise<unknown>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await run(cdp);
  } finally {
    await cdp.detach();
  }
}
