/**
 * EXIF and metadata stripping for served evidence images.
 *
 * DEFINITION OF BYTES & HASHES:
 * - `originalBytes`: The raw, exact file bytes uploaded by the client.
 *   The server computes `fileSha256` = SHA256(originalBytes).
 *   This hash is immutable and is pinned into the `expense.evidence_added` event.
 *   The integrity check job always verifies `originalBytes` against this pinned hash.
 * - `sanitizedBytes`: The image bytes with EXIF metadata (camera model, GPS coordinates,
 *   exposure data, software version, creator timestamps) stripped for privacy and security
 *   when serving thumbnails or image previews to viewers.
 */

/**
 * Strips EXIF metadata markers (APP1 0xFF 0xE1 and APP2 0xFF 0xE2) from JPEG images.
 */
function stripJpegExif(bytes: Uint8Array): Uint8Array {
  // Must start with SOI: 0xFF, 0xD8
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return bytes;
  }

  const out: number[] = [0xff, 0xd8];
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Not a valid marker prefix, copy remaining bytes
      for (let i = offset; i < bytes.length; i++) {
        const b = bytes[i];
        if (b !== undefined) out.push(b);
      }
      break;
    }

    const marker = bytes[offset + 1];
    if (marker === undefined) break;

    // Standalone markers: RST0-RST7 (0xD0-0xD7), SOI (0xD8), EOI (0xD9)
    if (marker === 0xd9) {
      // EOI (End of Image)
      out.push(0xff, 0xd9);
      break;
    }

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) {
      out.push(0xff, marker);
      offset += 2;
      continue;
    }

    // Segment with length
    if (offset + 3 >= bytes.length) break;
    const len1 = bytes[offset + 2];
    const len2 = bytes[offset + 3];
    if (len1 === undefined || len2 === undefined) break;
    const length = (len1 << 8) | len2;

    if (length < 2 || offset + 2 + length > bytes.length) {
      // Corrupt length, break out
      break;
    }

    // APP1 (0xE1: Exif, XMP) or APP2 (0xE2: ICC profile / FlashPix)
    if (marker === 0xe1 || marker === 0xe2) {
      // Skip this metadata segment
      offset += 2 + length;
    } else {
      // Keep segment
      for (let i = offset; i < offset + 2 + length; i++) {
        const b = bytes[i];
        if (b !== undefined) out.push(b);
      }
      offset += 2 + length;
    }
  }

  return new Uint8Array(out);
}

/**
 * Strips metadata chunks (eXIf, tEXt, iTXt, zTXt) from PNG images.
 */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  // PNG signature: 8 bytes
  if (bytes.length < 8) return bytes;

  const metadataChunkTypes = new Set(["eXIf", "tEXt", "iTXt", "zTXt"]);
  const out: number[] = [];

  // Copy signature
  for (let i = 0; i < 8; i++) {
    const b = bytes[i];
    if (b !== undefined) out.push(b);
  }

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const l0 = bytes[offset];
    const l1 = bytes[offset + 1];
    const l2 = bytes[offset + 2];
    const l3 = bytes[offset + 3];
    if (l0 === undefined || l1 === undefined || l2 === undefined || l3 === undefined) break;
    const length = (l0 << 24) | (l1 << 16) | (l2 << 8) | l3;

    if (offset + 12 + length > bytes.length) break;

    const chunkType = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );

    const totalChunkLength = 12 + length; // 4 len + 4 type + data + 4 crc

    if (metadataChunkTypes.has(chunkType)) {
      // Skip metadata chunk
      offset += totalChunkLength;
    } else {
      for (let i = offset; i < offset + totalChunkLength; i++) {
        const b = bytes[i];
        if (b !== undefined) out.push(b);
      }
      offset += totalChunkLength;
      if (chunkType === "IEND") break;
    }
  }

  return new Uint8Array(out);
}

/**
 * Strips EXIF metadata from image bytes according to MIME type.
 * For PDF or unknown types, returns original bytes unchanged.
 */
export function stripExifMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  switch (mimeType) {
    case "image/jpeg":
      return stripJpegExif(bytes);
    case "image/png":
      return stripPngMetadata(bytes);
    default:
      return bytes;
  }
}
