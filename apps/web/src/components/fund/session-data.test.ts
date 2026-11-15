import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "../../lib/api-client";
import { getPublicFund } from "./data";

afterEach(() => {
  vi.unstubAllGlobals();
  setApiClient(null);
});

it("forwards each server request's session without leaking it to the next visitor", async () => {
  const seen: (string | null)[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    seen.push(request.headers.get("cookie"));
    if (!request.headers.get("cookie")) return new Response(null, { status: 404 });
    const data = request.url.endsWith("summary")
      ? { fundId: "private", name: "Members only", raisedPaise: "100", spentPaise: "0" }
      : request.url.endsWith("breakdown")
        ? { categories: [] }
        : { items: [] };
    return Response.json(data);
  });
  expect((await getPublicFund("private", "yen_session=auditor"))?.name).toBe("Members only");
  expect(seen).toEqual(Array(3).fill("yen_session=auditor"));
  seen.length = 0;
  expect(await getPublicFund("private")).toBeNull();
  expect(seen).toEqual([null, null, null]);
});
