import { crc32 } from "node:zlib";
import * as unzipper from "unzipper";

/** Never extracts to disk; the budget counts actual streamed bytes, not ZIP claims. */
export async function readBoundedZip(
  bytes: Buffer,
  limits: { expandedBytes: number; files?: number; nesting?: number },
): Promise<{
  entries: { path: string; bytes: Buffer }[];
  expandedBytes: number;
}> {
  let archive: Awaited<ReturnType<typeof unzipper.Open.buffer>>;
  try {
    archive = await unzipper.Open.buffer(bytes);
  } catch {
    throw new Error("corrupt_input");
  }
  if (archive.files.length > (limits.files ?? 200))
    throw new Error("expansion_limit");
  const paths = new Set<string>();
  const entries: { path: string; bytes: Buffer }[] = [];
  let expandedBytes = 0;
  for (const entry of archive.files) {
    if (((entry as unknown as { flags?: number }).flags ?? 0) & 1)
      throw new Error("unsupported_format");
    const name = entry.path;
    const segments = name.split("/");
    if (
      !name ||
      name.length > 4096 ||
      name.startsWith("/") ||
      name.includes("\\") ||
      /^[A-Za-z]:/.test(name) ||
      [...name].some(
        (character) =>
          character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
      ) ||
      segments.includes("..") ||
      segments.includes(".") ||
      segments.slice(0, -1).includes("") ||
      paths.has(name)
    )
      throw new Error("corrupt_input");
    if (segments.length > (limits.nesting ?? 8))
      throw new Error("expansion_limit");
    paths.add(name);
    const attributes =
      (entry as unknown as { externalFileAttributes?: number })
        .externalFileAttributes ?? 0;
    const mode = (attributes >>> 16) & 0o17_0000;
    if (mode !== 0 && mode !== 0o10_0000 && mode !== 0o04_0000)
      throw new Error("corrupt_input");
    if (entry.type === "Directory") continue;
    if (entry.uncompressedSize > limits.expandedBytes - expandedBytes)
      throw new Error("expansion_limit");
    const chunks: Buffer[] = [];
    const stream = entry.stream();
    try {
      for await (const raw of stream) {
        const chunk = Buffer.from(raw as Uint8Array);
        expandedBytes += chunk.length;
        if (expandedBytes > limits.expandedBytes) {
          stream.destroy();
          throw new Error("expansion_limit");
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "expansion_limit")
        throw error;
      throw new Error("corrupt_input");
    }
    const content = Buffer.concat(chunks);
    if (
      content.length !== entry.uncompressedSize ||
      crc32(content) !== entry.crc32
    )
      throw new Error("corrupt_input");
    entries.push({ path: name, bytes: content });
  }
  return { entries, expandedBytes };
}
