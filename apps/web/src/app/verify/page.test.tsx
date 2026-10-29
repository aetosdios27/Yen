import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type AuditBundle,
  buildIntervalTree,
  computeCanonicalEventHash,
  fromHex,
  hash32,
  parseFundId,
  salt32,
  toHex,
} from "@yen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { en } from "../../i18n/messages/en";
import type { RecordProofData } from "../../lib/verifier";
import VerifyPage from "./page";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/verify",
}));

async function createFixtureData(): Promise<{
  validProof: RecordProofData;
  tamperedProof: RecordProofData;
  pendingProof: RecordProofData;
  bundle: AuditBundle;
}> {
  const fundResult = parseFundId("00000000-0000-4000-8000-000000000010");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;
  const recordId = "00000000-0000-4000-8000-000000000020";

  const event = {
    fund_id: fundId,
    seq: 1,
    type: "expense.submitted",
    version: 1,
    actor: "psn_00000000-0000-4000-8000-000000000002",
    occurred_at: "2026-10-28T00:00:00.000Z",
    payload: { expense_id: recordId, amount_paise: 8500000 },
    prev_hash: "0".repeat(64),
    hash: "",
  };

  event.hash = await computeCanonicalEventHash(event);
  const salt = "11".repeat(32);

  const tree = await buildIntervalTree([
    {
      fundId,
      latestEventHash: hash32(fromHex(event.hash)),
      events: [{ seq: 1, eventHash: hash32(fromHex(event.hash)), salt: salt32(fromHex(salt)) }],
    },
  ]);

  const proof = await tree.prove(fundId, 1);
  const root = toHex(tree.root);
  const eventRoot = toHex(tree.fundRoots[0] ?? hash32(new Uint8Array(32)));

  const validProof: RecordProofData = {
    recordId,
    fundId,
    status: "anchored",
    event,
    salt,
    latestEventHash: toHex(proof.latestEventHash),
    eventProof: {
      index: proof.eventProof.index,
      size: proof.eventProof.size,
      path: proof.eventProof.path.map(toHex),
    },
    fundProof: {
      index: proof.fundProof.index,
      size: proof.fundProof.size,
      path: proof.fundProof.path.map(toHex),
    },
    anchor: {
      chainId: 80002,
      contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      root,
      sequence: 1,
    },
  };

  // Tampered payload with original hash
  const tamperedProof: RecordProofData = {
    ...validProof,
    event: {
      ...event,
      payload: { expense_id: recordId, amount_paise: 9999999 },
    },
  };

  // Pending unanchored proof
  const pendingProof: RecordProofData = {
    recordId,
    fundId,
    status: "pending",
    event,
    pendingWindow: {
      estimatedAnchorMinutes: 30,
      message:
        "This record is safely recorded in the account book and awaiting the next scheduled seal batch.",
    },
  };

  const bundle: AuditBundle = {
    format: "yen/audit-bundle/v1",
    fund_id: fundId,
    chain: { start_seq: 0, start_hash: "0".repeat(64) },
    events: [
      {
        event,
        salt,
        latest_event_hash: toHex(proof.latestEventHash),
        eventProof: {
          index: proof.eventProof.index,
          size: proof.eventProof.size,
          path: proof.eventProof.path.map(toHex),
        },
        fundProof: {
          index: proof.fundProof.index,
          size: proof.fundProof.size,
          path: proof.fundProof.path.map(toHex),
        },
      },
    ],
    roots: [
      {
        start_seq: 1,
        end_seq: 1,
        event_root: eventRoot,
        fund_count: 1,
        global_root: root,
      },
    ],
    anchor: {
      chain_id: 80002,
      contract_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      root,
      sequence: 1,
    },
  };

  return { validProof, tamperedProof, pendingProof, bundle };
}

function mockValidProofFetch(validProof: RecordProofData, bundle: AuditBundle) {
  globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (urlStr.includes("/proof")) {
      return Promise.resolve(
        new Response(JSON.stringify(validProof), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (urlStr.includes("/audit-bundle")) {
      return Promise.resolve(
        new Response(JSON.stringify(bundle), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (urlStr.includes("polygon") || urlStr.includes("rpc")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${validProof.anchor?.root.replace(/^0x/, "")}`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.reject(new Error(`Unknown route: ${urlStr}`));
  });
}

describe("VerifyPage Component (page.tsx)", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    vi.clearAllMocks();
  });

  it("renders page header, input form, and bundle drop zone", () => {
    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain(en.verify.title);
    expect(screen.getByLabelText(en.verify.enterRecordIdLabel)).toBeDefined();
    expect(screen.getByLabelText(en.verify.fundIdLabel)).toBeDefined();
    expect(screen.getByText(en.verify.dropBundleHere)).toBeDefined();
    expect(screen.getByText(en.verify.downloadVerifierScript)).toBeDefined();
  });

  it("handles manual record verification submission and renders verified outcome", async () => {
    const { validProof, bundle } = await createFixtureData();
    mockValidProofFetch(validProof, bundle);

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const user = userEvent.setup();
    const recordInput = screen.getByLabelText(en.verify.enterRecordIdLabel);
    const fundInput = screen.getByLabelText(en.verify.fundIdLabel);
    const submitBtn = screen.getByRole("button", { name: en.verify.verifyButton });

    await user.type(recordInput, validProof.recordId);
    await user.type(fundInput, validProof.fundId);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomeVerified)).toBeDefined();
    });

    expect(screen.getByText("₹85,000.00")).toBeDefined();
  }, 20_000);

  it("auto-verifies when recordId and fundId are present in URL search parameters", async () => {
    const { validProof, bundle } = await createFixtureData();
    mockSearchParams = new URLSearchParams({
      recordId: validProof.recordId,
      fundId: validProof.fundId,
    });
    mockValidProofFetch(validProof, bundle);

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomeVerified)).toBeDefined();
    });

    expect(screen.getByText("₹85,000.00")).toBeDefined();
  }, 20_000);

  it("detects tampered record and renders failure banner in red", async () => {
    const { tamperedProof } = await createFixtureData();

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/proof")) {
        return Promise.resolve(
          new Response(JSON.stringify(tamperedProof), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unknown route: ${urlStr}`));
    });

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const user = userEvent.setup();
    const recordInput = screen.getByLabelText(en.verify.enterRecordIdLabel);
    const submitBtn = screen.getByRole("button", { name: en.verify.verifyButton });

    await user.type(recordInput, tamperedProof.recordId);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomeFailed)).toBeDefined();
    });

    expect(screen.getByText("Verification failed: record was altered")).toBeDefined();
  }, 20_000);

  it("handles pending unanchored records with plain-language notice", async () => {
    const { pendingProof } = await createFixtureData();

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/proof")) {
        return Promise.resolve(
          new Response(JSON.stringify(pendingProof), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unknown route: ${urlStr}`));
    });

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const user = userEvent.setup();
    const recordInput = screen.getByLabelText(en.verify.enterRecordIdLabel);
    const submitBtn = screen.getByRole("button", { name: en.verify.verifyButton });

    await user.type(recordInput, pendingProof.recordId);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomePending)).toBeDefined();
    });

    expect(
      screen.getByText(
        "This record is safely recorded in the account book and awaiting the next scheduled seal batch.",
      ),
    ).toBeDefined();
  }, 20_000);

  it("verifies uploaded audit bundle JSON file and renders bundle summary", async () => {
    const { bundle } = await createFixtureData();

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const file = new File([JSON.stringify(bundle)], "bundle.json", {
      type: "application/json",
    });

    const fileInput = document.getElementById("verify-bundle-file") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Audit Bundle Verified: 1 record(s) intact")).toBeDefined();
    });

    expect(screen.getByText(en.verify.downloadBundleJson)).toBeDefined();
    expect(screen.getByText(en.verify.downloadBundleCsv)).toBeDefined();
    expect(screen.getByText(en.verify.downloadVerifierScript)).toBeDefined();
  }, 20_000);

  it("toggles expandable technical details for skeptics", async () => {
    const { validProof, bundle } = await createFixtureData();
    mockValidProofFetch(validProof, bundle);

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const user = userEvent.setup();
    const recordInput = screen.getByLabelText(en.verify.enterRecordIdLabel);
    const submitBtn = screen.getByRole("button", { name: en.verify.verifyButton });

    await user.type(recordInput, validProof.recordId);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomeVerified)).toBeDefined();
    });

    expect(screen.getByText(en.verify.technicalInspectionTitle)).toBeDefined();
    expect(screen.getByText(en.verify.canonicalHashLabel)).toBeDefined();
    expect(screen.getByText(en.verify.declaredHashLabel)).toBeDefined();
    expect(screen.getByText("Raw Event Record")).toBeDefined();
  }, 20_000);

  it("renders skipped unverified outcome when RPC is unreachable", async () => {
    const { validProof, bundle } = await createFixtureData();
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/proof")) {
        return Promise.resolve(
          new Response(JSON.stringify(validProof), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("/audit-bundle")) {
        return Promise.resolve(
          new Response(JSON.stringify(bundle), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("RPC Error", { status: 500 }));
    });

    render(
      <LocaleProvider initialLocale="en">
        <VerifyPage />
      </LocaleProvider>,
    );

    const user = userEvent.setup();
    const recordInput = screen.getByLabelText(en.verify.enterRecordIdLabel);
    const submitBtn = screen.getByRole("button", { name: en.verify.verifyButton });

    await user.type(recordInput, validProof.recordId);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(en.verify.outcomeSkipped)).toBeDefined();
    });
  }, 20_000);
});
