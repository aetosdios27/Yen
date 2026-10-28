import qrcode from "qrcode-generator";
import { cn } from "./cn";

export interface QrCodeProps {
  value: string;
  label: string;
  className?: string;
}

/** A scannable code drawn as one SVG path, so it stays sharp at any size. */
export function QrCode({ value, label, className }: QrCodeProps) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();

  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${count} ${count}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("h-44 w-44 rounded-control bg-canvas p-2 text-ink", className)}
    >
      <rect width={count} height={count} fill="var(--color-canvas)" />
      <path d={path} fill="currentColor" />
    </svg>
  );
}
