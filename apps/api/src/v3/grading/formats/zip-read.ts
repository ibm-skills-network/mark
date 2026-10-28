import { Open as OpenZip } from "unzipper";

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
    const bytes = await entry.buffer();
    // Headers can lie; count the real bytes.
    total += bytes.length;
    return bytes.length > limits.maxEntryBytes ? undefined : bytes;
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
