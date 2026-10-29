/**
 * Binary magic bytes verification for allowed evidence MIME types.
 *
 * Verifies that the raw byte signature of an uploaded file matches its declared MIME type,
 * preventing MIME spoofing attacks (e.g. executable or HTML disguised as image/jpeg).
 */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function verifyMimeSignature(bytes: Uint8Array, declaredMime: string): boolean {
  if (bytes.length < 4) return false;

  switch (declaredMime) {
    case "image/jpeg":
      // JPEG files start with SOI marker: 0xFF, 0xD8, 0xFF
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

    case "image/png":
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      if (bytes.length < 8) return false;
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 && // P
        bytes[2] === 0x4e && // N
        bytes[3] === 0x47 && // G
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );

    case "image/webp":
      // WebP files start with 'RIFF' (bytes 0-3) and have 'WEBP' at bytes 8-11
      if (bytes.length < 12) return false;
      return (
        bytes[0] === 0x52 && // R
        bytes[1] === 0x49 && // I
        bytes[2] === 0x46 && // F
        bytes[3] === 0x46 && // F
        bytes[8] === 0x57 && // W
        bytes[9] === 0x45 && // E
        bytes[10] === 0x42 && // B
        bytes[11] === 0x50 // P
      );

    case "application/pdf":
      // PDF files start with '%PDF-' (0x25, 0x50, 0x44, 0x46, 0x2D)
      if (bytes.length < 5) return false;
      return (
        bytes[0] === 0x25 && // %
        bytes[1] === 0x50 && // P
        bytes[2] === 0x44 && // D
        bytes[3] === 0x46 && // F
        bytes[4] === 0x2d // -
      );

    default:
      return false;
  }
}
