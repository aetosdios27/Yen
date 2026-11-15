import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryFundStore } from "./dependencies.js";
import { devPolicy } from "./policy.js";

const owner = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const firstId = "00000000-0000-4000-8000-000000000010";
const secondId = "00000000-0000-4000-8000-000000000011";
function store() {
  const funds = new MemoryFundStore();
  const fixtures: [string, string][] = [
    [firstId, "Robotics"],
    [secondId, "Private club"],
  ];
  for (const [id, title] of fixtures) {
    funds.set(id, {
      owner,
      fund: {
        id,
        name: title,
        targetPaise: "10000",
        upiVpa: "club@bank",
        upiPayeeName: "Club",
        createdAt: "2026-01-01T00:00:00.000Z",
        visibility: "private",
      },
    });
  }
  return funds;
}
describe("my funds", () => {
  it("requires authentication", async () => {
    const response = await createApp().request("/v1/me/funds");
    expect(response.status).toBe(401);
  });
  it("lists ownership without exposing another user's funds", async () => {
    const fundStore = store();
    const own = await createApp({ fundStore, policy: devPolicy, principal: { id: owner } }).request(
      "/v1/me/funds",
    );
    expect(await own.json()).toEqual({
      funds: [
        { id: secondId, title: "Private club", role: "owner", visibility: "private" },
        { id: firstId, title: "Robotics", role: "owner", visibility: "private" },
      ],
    });
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    const other = await createApp({
      fundStore,
      policy: devPolicy,
      principal: { id: member },
    }).request("/v1/me/funds");
    expect(await other.json()).toEqual({ funds: [] });
  });
  it("uses active fund roles and removes access when membership ends", async () => {
    const fundStore = store();
    await fundStore.addMember({
      fundId: firstId,
      actorUserId: owner,
      userId: member,
      role: "approver",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const app = createApp({
      fundStore,
      policy: devPolicy,
      principal: { id: member, role: "owner" },
    });
    const response = await app.request("/v1/me/funds");
    expect(await response.json()).toEqual({
      funds: [{ id: firstId, title: "Robotics", role: "approver", visibility: "private" }],
    });
    await fundStore.removeMember({
      fundId: firstId,
      actorUserId: owner,
      userId: member,
      occurredAt: "2026-01-01T00:00:01.000Z",
    });
    expect(await (await app.request("/v1/me/funds")).json()).toEqual({ funds: [] });
  });
});
