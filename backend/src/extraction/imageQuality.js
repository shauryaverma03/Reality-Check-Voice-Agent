// Zero-dependency, best-effort image usability check. This is NOT blur/
// exposure detection — that needs real pixel analysis (edge/Laplacian
// variance), which no library in this project provides and which is easy to
// get wrong (false positives on legitimate photos). What this DOES check,
// honestly and deterministically:
//   - is the file implausibly small to be a real evidence photo
//   - if the pixel dimensions are readable (JPEG/PNG only), are they too
//     small to show a legible reading/nameplate
//
// When Claude vision is available, extractEvidenceFromPhoto asks it for a
// real readability judgment instead — this heuristic is only the fallback
// for when there's no AI call happening at all (no API key, or the call
// failed), so the pipeline still does *something* principled rather than
// blindly marking every upload "ok" regardless of content.

const MIN_BYTES = 3 * 1024; // below this, near-certainly not a real photo
const MIN_DIMENSION_PX = 300; // below this on either axis, a nameplate/gauge reading won't be legible

/** PNG: signature (8 bytes) + IHDR chunk starts immediately after; width/height are the first 8 bytes of IHDR's data (bytes 16-23 of the file), big-endian uint32 each. */
function readPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** JPEG: scan markers for the first Start-Of-Frame segment (0xC0-0xCF, excluding the DHT/JPG-extension markers 0xC4/0xC8/0xCC), which carries height then width as big-endian uint16 at a fixed offset within the segment. */
function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

function readDimensions(buffer, mimeType) {
  try {
    if (mimeType === 'image/png') return readPngDimensions(buffer);
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return readJpegDimensions(buffer);
  } catch {
    return null; // malformed/truncated file — treat as "couldn't determine", not a crash
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {{ readable: boolean, issue: string|null, note: string }}
 */
export function heuristicImageQuality(buffer, mimeType) {
  if (buffer.length < MIN_BYTES) {
    return {
      readable: false,
      issue: 'insufficient_image_evidence',
      note: `File is only ${buffer.length} bytes — too small to be a real evidence photo.`,
    };
  }

  const dims = readDimensions(buffer, mimeType);
  if (dims && (dims.width < MIN_DIMENSION_PX || dims.height < MIN_DIMENSION_PX)) {
    return {
      readable: false,
      issue: 'low_resolution',
      note: `Image is ${dims.width}×${dims.height}px — too small for a nameplate or gauge reading to be legible.`,
    };
  }

  return {
    readable: true,
    issue: null,
    note: dims
      ? `Heuristic check only (no AI): ${dims.width}×${dims.height}px, file size and dimensions look plausible. Blur/exposure not assessed without AI.`
      : 'Heuristic check only (no AI): file size looks plausible; dimensions not determined for this format. Blur/exposure not assessed without AI.',
  };
}
