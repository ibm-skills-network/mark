import { Open as OpenZip } from "unzipper";

/** An archive entry that inflates past its limit (headers can lie). */
export class ZipExpansionError extends Error {
  constructor(readonly limitBytes: number) {
    super(`archive entry expands past ${limitBytes} bytes`);
    this.name = "ZipExpansionError";
  }
}

interface StreamableEntry {
  stream(): NodeJS.ReadableStream;
}

/**
 * Inflates one entry, stopping as soon as the real bytes pass `maxBytes`.
 * The header's size is never trusted, so a bomb costs at most `maxBytes`.
 */
export async function readEntryCapped(
  entry: StreamableEntry,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  const stream = entry.stream();
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += bytes.length;
    if (length > maxBytes) {
      (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      throw new ZipExpansionError(maxBytes);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

/**
 * Inflates every entry of an archive, counting real bytes and keeping
 * none, and throws once the total passes `maxTotalBytes`. Run before
 * handing an archive to a parser that inflates it all in memory.
 */
export async function assertArchiveExpandsWithin(
  buffer: Buffer,
  maxTotalBytes: number,
): Promise<void> {
  const directory = await OpenZip.buffer(buffer);
  let total = 0;
  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const stream = entry.stream();
    for await (const chunk of stream) {
      total += Buffer.isBuffer(chunk) ? chunk.length : String(chunk).length;
      if (total > maxTotalBytes) {
        (
          stream as NodeJS.ReadableStream & { destroy?: () => void }
        ).destroy?.();
        throw new ZipExpansionError(maxTotalBytes);
      }
    }
  }
}

export interface ZipReadLimits {
  /** Uncompressed bytes for one entry; larger entries read as undefined. */
  maxEntryBytes: number;
  /** Uncompressed bytes across everything read from this archive. */
  maxTotalBytes: number;
}

export const OFFICE_ZIP_LIMITS: ZipReadLimits = {
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

/** Read-only view of an Office (OOXML) archive with size guards. */
export interface OfficeZip {
  paths: string[];
  size(path: string): number | undefined;
  /** Entry bytes, or undefined when missing or over a limit. */
  read(path: string): Promise<Buffer | undefined>;
  text(path: string): Promise<string | undefined>;
}

export async function openOfficeZip(
  buffer: Buffer,
  limits: ZipReadLimits = OFFICE_ZIP_LIMITS,
): Promise<OfficeZip> {
  const directory = await OpenZip.buffer(buffer);
  const entries = new Map(
    directory.files
      .filter((entry) => entry.type === "File")
      .map((entry) => [entry.path, entry]),
  );
  let total = 0;
  const read = async (path: string): Promise<Buffer | undefined> => {
    const entry = entries.get(path);
    if (!entry || entry.uncompressedSize > limits.maxEntryBytes) {
      return undefined;
    }
    if (total + entry.uncompressedSize > limits.maxTotalBytes) return undefined;
    let bytes: Buffer;
    try {
      // Headers can lie: inflate no further than what is left of the budget.
      bytes = await readEntryCapped(
        entry,
        Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total),
      );
    } catch (error) {
      if (error instanceof ZipExpansionError) return undefined;
      throw error;
    }
    total += bytes.length;
    return bytes;
  };
  return {
    paths: [...entries.keys()],
    size: (path) => entries.get(path)?.uncompressedSize,
    read,
    async text(path) {
      const bytes = await read(path);
      return bytes?.toString("utf8");
    },
  };
}

/** Relationship id → target, resolved against the part's folder. */
export function parseRelationships(
  xml: string,
  partFolder: string,
): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = match[1];
    const id = /\bId="([^"]*)"/.exec(attributes)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(attributes)?.[1];
    const type = /\bType="([^"]*)"/.exec(attributes)?.[1] ?? "";
    if (!id || !target) continue;
    if (/\bTargetMode="External"/.test(attributes)) continue;
    map.set(id, { target: resolvePartPath(partFolder, target), type });
  }
  return map;
}

/** Join an OOXML relative target onto a folder, handling ../ and /abs. */
export function resolvePartPath(folder: string, target: string): string {
  const segments = target.startsWith("/")
    ? []
    : folder.split("/").filter((segment) => segment.length > 0);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

export function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
