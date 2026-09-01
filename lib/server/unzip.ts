import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * MINIMAL, DEFENSIVE ZIP READER for the admin knowledge importer.
 *
 * Reads the central directory of a fully buffered archive and extracts only
 * entries that pass every guard. Written in-house (the codebase already
 * writes zips in lib/server/zip.ts) so the attack surface is exactly what
 * this file shows:
 *
 *   - path traversal: any `..` segment, absolute path, drive letter or
 *     backslash is rejected;
 *   - symlinks: unix mode from external attributes is checked;
 *   - zip bombs: per-file and cumulative UNCOMPRESSED budgets are enforced
 *     BEFORE inflating, and the inflated output is re-checked;
 *   - executables/scripts: only the extension whitelist gets extracted —
 *     everything else is skipped (listed in `skipped`), never written;
 *   - entry-count cap against directory-flooding archives.
 */

const MAX_ENTRIES = 400;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "jpg", "jpeg", "png", "webp", "avif",
  "pdf", "json", "txt", "md",
]);

export type ZipEntry = { path: string; data: Buffer };
export type UnzipResult = { entries: ZipEntry[]; skipped: string[] };

class ZipError extends Error {
  constructor(public code: string) { super(code); }
}

function readEocd(buf: Buffer): { cdOffset: number; cdCount: number } {
  // EOCD signature 0x06054b50, scan the trailing 64KB+22 window backwards.
  const min = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return { cdCount: buf.readUInt16LE(i + 10), cdOffset: buf.readUInt32LE(i + 16) };
    }
  }
  throw new ZipError("zip_invalid");
}

function safePath(raw: string): string | null {
  if (raw.length === 0 || raw.length > 300) return null;
  if (raw.includes("\\") || raw.includes("\0")) return null;
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
  const segments = raw.split("/");
  if (segments.some((s) => s === ".." || s === "")) return null;
  return segments.join("/");
}

export function unzipSafe(buf: Buffer): UnzipResult {
  const { cdOffset, cdCount } = readEocd(buf);
  if (cdCount > MAX_ENTRIES) throw new ZipError("zip_too_many_files");

  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let total = 0;
  let ptr = cdOffset;

  for (let n = 0; n < cdCount; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw new ZipError("zip_invalid");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const externalAttrs = buf.readUInt32LE(ptr + 38);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const rawName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    if (rawName.endsWith("/")) continue; // directory
    const name = safePath(rawName);
    if (!name) { skipped.push(rawName.slice(0, 120)); continue; }

    // Unix file type rides in the top 4 bits of the high word: 0xA = symlink.
    const unixType = (externalAttrs >>> 28) & 0xf;
    if (unixType === 0xa) { skipped.push(name); continue; }

    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.has(ext)) { skipped.push(name); continue; }

    if (uncompSize > MAX_FILE_BYTES) throw new ZipError("zip_file_too_large");
    if (total + uncompSize > MAX_TOTAL_BYTES) throw new ZipError("zip_too_large");
    if (method !== 0 && method !== 8) { skipped.push(name); continue; }

    // Local header: skip its own (possibly different) name/extra lengths.
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError("zip_invalid");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) throw new ZipError("zip_invalid");
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: MAX_FILE_BYTES });
      } catch {
        throw new ZipError("zip_file_too_large");
      }
    }
    // The declared size is attacker-controlled — budget on the REAL size.
    if (data.length > MAX_FILE_BYTES) throw new ZipError("zip_file_too_large");
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new ZipError("zip_too_large");

    entries.push({ path: name, data });
  }
  return { entries, skipped };
}

export function isZipError(e: unknown): e is ZipError {
  return e instanceof ZipError;
}
