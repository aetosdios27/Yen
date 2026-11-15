import { afterEach, expect, it, vi } from "vitest";
import { fundDestination, loadProductSession } from "./product-session";

afterEach(() => vi.unstubAllGlobals());
it("uses the API name and real memberships", async () => {
  const funds = [
    { id: "actual-fund", title: "Residents", role: "treasurer", visibility: "members" },
  ];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Priya" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ funds }) }),
  );
  expect(await loadProductSession()).toEqual({ kind: "ready", name: "Priya", funds });
});
it("does not turn a failed funds request into an empty membership list", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Priya" }) })
      .mockResolvedValueOnce({ ok: false, status: 500 }),
  );
  await expect(loadProductSession()).rejects.toThrow("Funds unavailable");
});
it("treats an expired or pending-device session as signed out without loading funds", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  vi.stubGlobal("fetch", fetch);
  expect(await loadProductSession()).toEqual({ kind: "signedOut" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("routes fund roles to their working view", () => {
  const base = { id: "real-id", title: "Residents", visibility: "members" } as const;
  expect(fundDestination({ ...base, role: "member" })).toBe("/funds/real-id");
  expect(fundDestination({ ...base, role: "auditor" })).toBe("/funds/real-id");
  for (const role of ["owner", "treasurer", "approver"] as const)
    expect(fundDestination({ ...base, role })).toBe("/funds/real-id/dashboard");
});
