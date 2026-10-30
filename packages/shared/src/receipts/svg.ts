import qrcode from "qrcode-generator";
import { formatInr } from "../paise.js";
import type { DonorReceiptData } from "./types.js";

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateQrPath(text: string): { path: string; count: number } {
  // Use Type 0 (auto-detect version) with Medium error correction
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();

  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        path += `M${col} ${row}h1v1h-1z `;
      }
    }
  }

  return { path, count };
}

export function generateReceiptSvg(data: DonorReceiptData): string {
  const proofUrl =
    data.proofUrl ?? `https://yen.org.in/verify?donationId=${encodeURIComponent(data.donationId)}`;
  const qr = generateQrPath(proofUrl);

  const formattedAmount = formatInr(data.amountPaise);
  const fundTitle = escapeXml(data.fundTitle);
  const donationId = escapeXml(data.donationId);
  const utr = escapeXml(data.utr);
  const donorName = escapeXml(
    data.donorDisplayName && data.donorDisplayName.trim().length > 0
      ? data.donorDisplayName
      : data.donorNameChoice === "anonymous"
        ? "Anonymous Donor (नाम गुप्त)"
        : "Community Contributor",
  );

  const isVerified = data.status === "verified";
  const statusColor = isVerified ? "#15803d" : "#b45309";
  const statusBg = isVerified ? "#dcfce7" : "#fef3c7";
  const statusBorder = isVerified ? "#86efac" : "#fde68a";
  const statusTextEn = isVerified ? "VERIFIED CONTRIBUTION" : "RECORDED (WAITING FOR BANK)";
  const statusTextHi = isVerified ? "सत्यापित योगदान" : "दर्ज (बैंक मिलान प्रतीक्षारत)";

  const dateStr = escapeXml(
    `${new Date(data.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1120" width="800" height="1120" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.06" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="1120" fill="#f8fafc" />

  <!-- Outer Border & Certificate Frame -->
  <rect x="24" y="24" width="752" height="1072" rx="16" fill="#ffffff" stroke="#e2e8f0" stroke-width="2" filter="url(#shadow)" />
  <rect x="36" y="36" width="728" height="1048" rx="12" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="6 4" />

  <!-- Header Banner -->
  <rect x="48" y="48" width="704" height="100" rx="10" fill="url(#headerGrad)" />
  <text x="76" y="90" fill="#38bdf8" font-size="14" font-weight="700" letter-spacing="2">YEN · COMMUNITY FUND RECORD</text>
  <text x="76" y="122" fill="#ffffff" font-size="24" font-weight="800" letter-spacing="1">DONATION RECEIPT · दान रसीद</text>
  <text x="712" y="105" text-anchor="end" fill="#94a3b8" font-size="13" font-family="monospace">ID: ${donationId.slice(0, 8)}</text>

  <!-- Status Badge -->
  <g transform="translate(48, 168)">
    <rect width="704" height="52" rx="8" fill="${statusBg}" stroke="${statusBorder}" stroke-width="1.5" />
    <circle cx="28" cy="26" r="10" fill="${statusColor}" />
    <path d="M24 26 l3 3 l6 -6" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <text x="48" y="32" fill="${statusColor}" font-size="15" font-weight="700">${statusTextEn} · ${statusTextHi}</text>
  </g>

  <!-- Amount Highlight Box -->
  <g transform="translate(48, 238)">
    <rect width="704" height="110" rx="10" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="1" />
    <text x="32" y="42" fill="#64748b" font-size="13" font-weight="600" text-transform="uppercase" letter-spacing="1.5">Amount Contributed · योगदान राशि</text>
    <text x="32" y="90" fill="#0f172a" font-size="44" font-weight="800" font-family="monospace">${formattedAmount}</text>
  </g>

  <!-- Key Details Grid -->
  <g transform="translate(48, 368)">
    <!-- Column 1 -->
    <text x="0" y="20" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">Community Fund · निधि नाम</text>
    <text x="0" y="44" fill="#0f172a" font-size="18" font-weight="700">${fundTitle}</text>

    <text x="0" y="86" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">Contributor · दानकर्ता</text>
    <text x="0" y="108" fill="#0f172a" font-size="16" font-weight="600">${donorName}</text>

    <text x="0" y="150" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">Date &amp; Time · समय</text>
    <text x="0" y="172" fill="#0f172a" font-size="15" font-family="monospace">${dateStr}</text>

    <!-- Column 2 -->
    <text x="380" y="20" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">UPI Reference (UTR) · संदर्भ</text>
    <text x="380" y="44" fill="#0f172a" font-size="18" font-weight="700" font-family="monospace">${utr}</text>

    <text x="380" y="86" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">Receipt ID · रसीद पहचान</text>
    <text x="380" y="108" fill="#334155" font-size="13" font-family="monospace">${donationId}</text>

    <text x="380" y="150" fill="#64748b" font-size="12" font-weight="600" text-transform="uppercase" letter-spacing="1">Proof Verification · प्रमाण स्थिति</text>
    <text x="380" y="172" fill="#0284c7" font-size="14" font-weight="600">${isVerified ? "Tamper-evident cryptographic record" : "Awaiting statement reconciliation"}</text>
  </g>

  <!-- Divider -->
  <line x1="48" y1="570" x2="752" y2="570" stroke="#e2e8f0" stroke-width="1.5" />

  <!-- Verification QR Code & Link Section -->
  <g transform="translate(48, 595)">
    <rect width="704" height="210" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />

    <!-- QR Code SVG -->
    <g transform="translate(24, 20)">
      <rect width="170" height="170" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
      <g transform="translate(15, 15)">
        <svg width="140" height="140" viewBox="0 0 ${qr.count} ${qr.count}">
          <path d="${qr.path}" fill="#0f172a" />
        </svg>
      </g>
    </g>

    <!-- Verification Info -->
    <g transform="translate(216, 32)">
      <text x="0" y="20" fill="#0f172a" font-size="18" font-weight="700">Check This Donation · इस दान की जांच करें</text>
      <text x="0" y="48" fill="#475569" font-size="13" width="460">
        Scan the QR code or click the proof link to independently verify this donation
      </text>
      <text x="0" y="68" fill="#475569" font-size="13">
        against the cryptographic account book and on-chain anchor.
      </text>

      <rect x="0" y="90" width="464" height="40" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1" />
      <text x="12" y="115" fill="#0369a1" font-size="13" font-family="monospace">${escapeXml(proofUrl)}</text>

      <text x="0" y="155" fill="#64748b" font-size="12">
        Independent verifiable proof · No login required to inspect
      </text>
    </g>
  </g>

  <!-- Explicit NON-80G TAX DISCLAIMER Box (MANDATORY REQUIREMENT) -->
  <g transform="translate(48, 830)">
    <rect width="704" height="180" rx="10" fill="#fffbeb" stroke="#fcd34d" stroke-width="1.5" />

    <!-- Warning Icon -->
    <g transform="translate(24, 20)">
      <path d="M16 4 L30 28 L2 28 Z" fill="#d97706" />
      <text x="16" y="25" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold">!</text>
    </g>

    <text x="64" y="36" fill="#92400e" font-size="15" font-weight="800" letter-spacing="0.5">
      IMPORTANT NOTICE: NOT AN 80G TAX EXEMPTION RECEIPT
    </text>
    <text x="64" y="56" fill="#b45309" font-size="14" font-weight="700">
      महत्वपूर्ण सूचना: यह 80G कर छूट रसीद नहीं है
    </text>

    <!-- English Notice -->
    <text x="24" y="92" fill="#78350f" font-size="13" font-weight="500">
      ${escapeXml(data.disclaimerEn)}
    </text>

    <!-- Hindi Notice -->
    <text x="24" y="126" fill="#78350f" font-size="13" font-weight="500">
      ${escapeXml(data.disclaimerHi)}
    </text>

    <text x="24" y="158" fill="#92400e" font-size="12" font-style="italic">
      Yen is a transparent community accounting platform and does not provide tax exemption certificates.
    </text>
  </g>

  <!-- Footer Seal -->
  <g transform="translate(48, 1035)">
    <line x1="0" y1="0" x2="704" y2="0" stroke="#e2e8f0" stroke-width="1" />
    <text x="0" y="24" fill="#94a3b8" font-size="12">Yen · Community money you can check · Tamper-evident transparency</text>
    <text x="704" y="24" text-anchor="end" fill="#94a3b8" font-size="12">https://yen.org.in</text>
  </g>
</svg>`;
}
