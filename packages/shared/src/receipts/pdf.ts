import qrcode from "qrcode-generator";
import { formatInr } from "../paise.js";
import type { DonorReceiptData } from "./types.js";

function escapePdfText(text: string): string {
  // Replace characters outside printable ASCII or escape backslash and parentheses
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

export function generateReceiptPdf(data: DonorReceiptData): Uint8Array {
  const proofUrl =
    data.proofUrl ?? `https://yen.org.in/verify?donationId=${encodeURIComponent(data.donationId)}`;

  // Generate QR code
  const qr = qrcode(0, "M");
  qr.addData(proofUrl);
  qr.make();
  const qrModules = qr.getModuleCount();

  const formattedInr = formatInr(data.amountPaise);
  // Replace ₹ with INR for standard Type 1 font compatibility
  const amountStr = formattedInr.replace(/^₹/, "INR ");
  const isVerified = data.status === "verified";
  const statusStr = isVerified ? "VERIFIED CONTRIBUTION" : "RECORDED (WAITING FOR BANK)";
  const donorName =
    data.donorDisplayName && data.donorDisplayName.trim().length > 0
      ? data.donorDisplayName
      : data.donorNameChoice === "anonymous"
        ? "Anonymous Contributor"
        : "Community Contributor";
  const dateStr = `${new Date(data.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC`;

  // Build stream content
  // A4 dimensions: 595.28 x 841.89 points
  // Origin (0,0) is bottom-left in PDF coordinates
  const streamLines: string[] = [];

  // Top header banner (dark slate)
  streamLines.push("q");
  streamLines.push("0.06 0.09 0.16 rg"); // #0f172a
  streamLines.push("36 745 523 60 re f"); // x=36, y=745, w=523, h=60

  // Header text
  streamLines.push("BT");
  streamLines.push("/F2 10 Tf"); // Helvetica-Bold 10pt
  streamLines.push("0.22 0.74 0.97 rg"); // #38bdf8 (light blue)
  streamLines.push("56 785 Td");
  streamLines.push(`(${escapePdfText("YEN - COMMUNITY FUND RECORD")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 16 Tf");
  streamLines.push("1.0 1.0 1.0 rg"); // White
  streamLines.push("56 760 Td");
  streamLines.push(`(${escapePdfText("DONATION RECEIPT")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F3 9 Tf"); // Courier 9pt
  streamLines.push("0.6 0.65 0.72 rg");
  streamLines.push("440 760 Td");
  streamLines.push(`(ID: ${escapePdfText(data.donationId.slice(0, 8))}) Tj`);
  streamLines.push("ET");
  streamLines.push("Q"); // restore

  // Status badge box
  streamLines.push("q");
  if (isVerified) {
    streamLines.push("0.86 0.99 0.91 rg"); // Light green #dcfce7
    streamLines.push("0.08 0.50 0.24 RG"); // Green border #15803d
  } else {
    streamLines.push("0.99 0.95 0.78 rg"); // Light amber #fef3c7
    streamLines.push("0.71 0.33 0.04 RG"); // Amber border #b45309
  }
  streamLines.push("1.5 w");
  streamLines.push("36 695 523 38 re B"); // Fill and Stroke
  streamLines.push("BT");
  streamLines.push("/F2 12 Tf");
  if (isVerified) {
    streamLines.push("0.08 0.50 0.24 rg");
  } else {
    streamLines.push("0.71 0.33 0.04 rg");
  }
  streamLines.push("56 710 Td");
  streamLines.push(`(${escapePdfText(statusStr)}) Tj`);
  streamLines.push("ET");
  streamLines.push("Q");

  // Amount box
  streamLines.push("q");
  streamLines.push("0.95 0.96 0.98 rg"); // Slate-100
  streamLines.push("0.88 0.91 0.94 RG");
  streamLines.push("1.0 w");
  streamLines.push("36 605 523 75 re B");
  streamLines.push("BT");
  streamLines.push("/F2 9 Tf");
  streamLines.push("0.39 0.45 0.55 rg"); // Gray label
  streamLines.push("56 658 Td");
  streamLines.push(`(${escapePdfText("AMOUNT CONTRIBUTED")}) Tj`);
  streamLines.push("ET");
  streamLines.push("BT");
  streamLines.push("/F2 26 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("56 626 Td");
  streamLines.push(`(${escapePdfText(amountStr)}) Tj`);
  streamLines.push("ET");
  streamLines.push("Q");

  // Details Grid
  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("36 575 Td");
  streamLines.push(`(${escapePdfText("COMMUNITY FUND")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 13 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("36 558 Td");
  streamLines.push(`(${escapePdfText(data.fundTitle)}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("36 530 Td");
  streamLines.push(`(${escapePdfText("CONTRIBUTOR")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F1 11 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("36 515 Td");
  streamLines.push(`(${escapePdfText(donorName)}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("36 488 Td");
  streamLines.push(`(${escapePdfText("DATE & TIME")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F3 10 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("36 474 Td");
  streamLines.push(`(${escapePdfText(dateStr)}) Tj`);
  streamLines.push("ET");

  // Column 2
  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("310 575 Td");
  streamLines.push(`(${escapePdfText("UPI REFERENCE (UTR)")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F3 13 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("310 558 Td");
  streamLines.push(`(${escapePdfText(data.utr)}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("310 530 Td");
  streamLines.push(`(${escapePdfText("RECEIPT ID")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F3 9 Tf");
  streamLines.push("0.2 0.25 0.33 rg");
  streamLines.push("310 515 Td");
  streamLines.push(`(${escapePdfText(data.donationId)}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F2 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("310 488 Td");
  streamLines.push(`(${escapePdfText("PROOF STATUS")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F1 10 Tf");
  streamLines.push("0.01 0.52 0.78 rg");
  streamLines.push("310 474 Td");
  streamLines.push(
    `(${escapePdfText(isVerified ? "Tamper-evident record" : "Awaiting bank statement")}) Tj`,
  );
  streamLines.push("ET");

  // Horizontal divider
  streamLines.push("q");
  streamLines.push("0.88 0.91 0.94 RG");
  streamLines.push("1.0 w");
  streamLines.push("36 450 523 0 re S");
  streamLines.push("Q");

  // QR Code & Verification Box
  // Box: x=36, y=285, w=523, h=150
  streamLines.push("q");
  streamLines.push("1.0 1.0 1.0 rg");
  streamLines.push("0.88 0.91 0.94 RG");
  streamLines.push("1.0 w");
  streamLines.push("36 285 523 150 re B");

  // Draw QR code vector modules inside box at x=56, y=305, size=110x110
  const qrSize = 110;
  const qrX = 56;
  const qrY = 305;
  const modSize = qrSize / qrModules;

  streamLines.push("0.06 0.09 0.16 rg"); // QR color #0f172a
  for (let r = 0; r < qrModules; r += 1) {
    for (let c = 0; c < qrModules; c += 1) {
      if (qr.isDark(r, c)) {
        // PDF Y-axis is inverted relative to row
        const modX = (qrX + c * modSize).toFixed(2);
        const modY = (qrY + (qrModules - 1 - r) * modSize).toFixed(2);
        const modW = (modSize + 0.05).toFixed(2);
        const modH = (modSize + 0.05).toFixed(2);
        streamLines.push(`${modX} ${modY} ${modW} ${modH} re f`);
      }
    }
  }

  // Verification text next to QR code
  streamLines.push("BT");
  streamLines.push("/F2 13 Tf");
  streamLines.push("0.06 0.09 0.16 rg");
  streamLines.push("186 400 Td");
  streamLines.push(`(${escapePdfText("CHECK THIS DONATION")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F1 9 Tf");
  streamLines.push("0.28 0.33 0.41 rg");
  streamLines.push("186 382 Td");
  streamLines.push(
    `(${escapePdfText("Scan the QR code or visit the link below to independently verify")}) Tj`,
  );
  streamLines.push("186 370 Td");
  streamLines.push(
    `(${escapePdfText("this donation against the cryptographic proof and on-chain anchor.")}) Tj`,
  );
  streamLines.push("ET");

  // URL link box
  streamLines.push("q");
  streamLines.push("0.95 0.96 0.98 rg");
  streamLines.push("0.80 0.83 0.88 RG");
  streamLines.push("0.8 w");
  streamLines.push("186 332 353 26 re B");
  streamLines.push("BT");
  streamLines.push("/F3 8 Tf");
  streamLines.push("0.01 0.41 0.63 rg");
  streamLines.push("194 342 Td");
  streamLines.push(`(${escapePdfText(proofUrl)}) Tj`);
  streamLines.push("ET");
  streamLines.push("Q");

  streamLines.push("BT");
  streamLines.push("/F1 8 Tf");
  streamLines.push("0.39 0.45 0.55 rg");
  streamLines.push("186 312 Td");
  streamLines.push(
    `(${escapePdfText("Independent verification - No login required to inspect proof")}) Tj`,
  );
  streamLines.push("ET");
  streamLines.push("Q");

  // MANDATORY NON-80G TAX DISCLAIMER BOX
  // Box: x=36, y=140, w=523, h=125
  streamLines.push("q");
  streamLines.push("1.0 0.98 0.92 rg"); // Amber-50 #fffbeb
  streamLines.push("0.99 0.83 0.30 RG"); // Amber-300 #fcd34d
  streamLines.push("1.5 w");
  streamLines.push("36 140 523 125 re B");

  streamLines.push("BT");
  streamLines.push("/F2 11 Tf");
  streamLines.push("0.57 0.25 0.05 rg"); // Amber-900 #92400e
  streamLines.push("56 242 Td");
  streamLines.push(`(${escapePdfText("IMPORTANT NOTICE: NOT AN 80G TAX EXEMPTION RECEIPT")}) Tj`);
  streamLines.push("ET");

  streamLines.push("BT");
  streamLines.push("/F1 9 Tf");
  streamLines.push("0.47 0.21 0.06 rg"); // Amber-950 #78350f
  streamLines.push("56 220 Td");
  streamLines.push(
    `(${escapePdfText("This receipt confirms a voluntary contribution to the community fund and does NOT qualify")}) Tj`,
  );
  streamLines.push("56 208 Td");
  streamLines.push(
    `(${escapePdfText("for tax deduction or exemption under Section 80G of the Indian Income Tax Act.")}) Tj`,
  );
  streamLines.push("56 186 Td");
  streamLines.push(
    `(${escapePdfText("Yen is an open community transparency platform, not a tax-exempt foundation.")}) Tj`,
  );
  streamLines.push("56 164 Td");
  streamLines.push(
    `(${escapePdfText("No tax exemption certificate has been or will be issued for this payment.")}) Tj`,
  );
  streamLines.push("ET");
  streamLines.push("Q");

  // Footer branding
  streamLines.push("BT");
  streamLines.push("/F1 8 Tf");
  streamLines.push("0.58 0.64 0.72 rg");
  streamLines.push("36 90 Td");
  streamLines.push(
    `(${escapePdfText("Yen - Community money you can check - https://yen.org.in")}) Tj`,
  );
  streamLines.push("ET");

  const streamContent = streamLines.join("\n");
  const streamLength = Buffer.byteLength(streamContent, "utf8");

  // Build PDF Objects
  const objects: string[] = [];

  // Obj 1: Catalog
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Obj 2: Pages
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // Obj 3: Page (A4: 595.28 x 841.89)
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources 5 0 R >>\nendobj\n",
  );

  // Obj 4: Content Stream
  objects.push(
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  );

  // Obj 5: Resources
  objects.push(
    "5 0 obj\n<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> /F3 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> >> >>\nendobj\n",
  );

  // Compute xref
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const startxref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    const off = offsets[i] ?? 0;
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}
