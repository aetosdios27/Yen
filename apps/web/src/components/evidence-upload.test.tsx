import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { expectNoA11yViolations } from "../test/a11y";
import { type EvidenceItem, EvidenceUpload } from "./evidence-upload";

function renderWithI18n(ui: React.ReactElement, locale = "en") {
  return render(<LocaleProvider initialLocale={locale as "en"}>{ui}</LocaleProvider>);
}

const mockEvidenceList: EvidenceItem[] = [
  {
    evidenceId: "00000000-0000-4000-8000-000000000001",
    fileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/jpeg",
    fileSizeBytes: 204800,
    vendorName: "Stationery Mart",
    gstin: "27AAPFU0939F1ZV",
    invoiceNumber: "INV-2026-001",
    invoiceDate: "2026-10-20",
    createdAt: "2026-10-28T12:00:00.000Z",
    fileUrl: "https://example.com/mock-receipt.jpg",
  },
  {
    evidenceId: "00000000-0000-4000-8000-000000000002",
    fileSha256: "ca978112ca1bbdcdafac231b39a23dc4da786081441606b387f9dac142373a75",
    mimeType: "application/pdf",
    fileSizeBytes: 1048576,
    vendorName: "Hardware Supplies",
    gstin: "09AAAUP8175A1ZG",
    invoiceNumber: "INV-2026-002",
    createdAt: "2026-10-28T13:00:00.000Z",
    duplicateDetected: true,
    isDuplicate: true,
    duplicateExpenseId: "00000000-0000-4000-8000-000000000099",
  },
];

describe("EvidenceUpload component", () => {
  it("configures mobile camera capture and desktop/file picker inputs correctly", () => {
    const { container } = renderWithI18n(<EvidenceUpload />);

    const cameraInput = container.querySelector(
      'input[type="file"][capture="environment"]',
    ) as HTMLInputElement | null;
    expect(cameraInput).not.toBeNull();
    expect(cameraInput?.getAttribute("accept")).toBe("image/*");
    expect(cameraInput?.getAttribute("aria-label")).toBe("Take photo");

    const fileInput = container.querySelector(
      'input[type="file"]:not([capture])',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    expect(fileInput?.getAttribute("accept")).toBe("image/*,application/pdf");
    expect(fileInput?.getAttribute("aria-label")).toBe("Choose file");
  });

  it("renders empty gallery state when no evidence is attached", () => {
    renderWithI18n(<EvidenceUpload existingEvidence={[]} />);

    expect(screen.getAllByText("Bills and evidence").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("No bill attached")).toBeDefined();
    expect(
      screen.getByText("Upload a photo or PDF of the receipt to support this expense."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeDefined();
  });

  it("renders existing evidence items with vendor details and duplicate warning", () => {
    const { container } = renderWithI18n(<EvidenceUpload existingEvidence={mockEvidenceList} />);

    expect(screen.getByText("Stationery Mart")).toBeDefined();
    expect(screen.getByText("GSTIN: 27AAPFU0939F1ZV")).toBeDefined();
    expect(screen.getByText("200.0 KB")).toBeDefined();

    expect(screen.getByText("Hardware Supplies")).toBeDefined();
    expect(screen.getByText("GSTIN: 09AAAUP8175A1ZG")).toBeDefined();
    expect(screen.getByText("1.0 MB")).toBeDefined();

    // Duplicate warning banner rendered for second item
    const duplicateWarning = screen.getByRole("note");
    expect(duplicateWarning).toBeDefined();
    expect(duplicateWarning.textContent).toContain(
      "Notice: This identical document was previously attached to another expense request.",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens zoom dialog with document details and closes on dismiss or Escape", () => {
    renderWithI18n(<EvidenceUpload existingEvidence={mockEvidenceList} />);

    // Click "View full size" on the first item
    const viewButtons = screen.getAllByRole("button", { name: "View full size" });
    const firstViewButton = viewButtons[0];
    if (!firstViewButton) throw new Error("view button not found");
    fireEvent.click(firstViewButton);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(screen.getByRole("heading", { name: "Stationery Mart" })).toBeDefined();
    expect(screen.getByText("27AAPFU0939F1ZV")).toBeDefined();
    expect(screen.getByText("INV-2026-001")).toBeDefined();

    // Close via close button
    const closeButtons = screen.getAllByRole("button", { name: "Close preview" });
    const firstCloseButton = closeButtons[0];
    if (!firstCloseButton) throw new Error("close button not found");
    fireEvent.click(firstCloseButton);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Reopen and close via Escape key
    fireEvent.click(firstViewButton);
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders in Hindi without English leak", () => {
    renderWithI18n(<EvidenceUpload existingEvidence={[]} />, "hi");

    expect(screen.getAllByText("बिल और प्रमाण").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("कोई बिल संलग्न नहीं है")).toBeDefined();
    expect(screen.getByRole("button", { name: "फ़ोटो लें" })).toBeDefined();
    expect(screen.getByRole("button", { name: "फ़ाइल चुनें" })).toBeDefined();
  });

  it("passes axe accessibility checks on populated gallery", async () => {
    await expectNoA11yViolations(<EvidenceUpload existingEvidence={mockEvidenceList} />);
  });

  it("passes axe accessibility checks on empty state in Hindi", async () => {
    await expectNoA11yViolations(<EvidenceUpload existingEvidence={[]} />, "hi");
  });
});
