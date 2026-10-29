import { Readable } from "node:stream";
import JSZip from "jszip";
import {
  assertArchiveExpandsWithin,
  openOfficeZip,
  readEntryCapped,
  ZipExpansionError,
} from "./zip-read";

/** An entry whose stream never ends, like a bomb whose header says 1 KB. */
function endlessEntry() {
  return {
    stream: () =>
      new Readable({
        read() {
          this.push(Buffer.alloc(64 * 1024));
        },
      }),
  };
}

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Rewrites every local and central header to claim `size` bytes. */
function understateSizes(buffer: Buffer, size: number): Buffer {
  const out = Buffer.from(buffer);
  for (let offset = 0; offset < out.length - 4; offset += 1) {
    const signature = out.readUInt32LE(offset);
    if (signature === 0x04_03_4b_50) out.writeUInt32LE(size, offset + 22);
    if (signature === 0x02_01_4b_50) out.writeUInt32LE(size, offset + 24);
  }
  return out;
}

describe("readEntryCapped", () => {
  it("stops an entry that inflates past the cap, whatever its header says", async () => {
    await expect(readEntryCapped(endlessEntry(), 1024 * 1024)).rejects.toThrow(
      ZipExpansionError,
    );
  });

  it("returns an entry within the cap", async () => {
    const directory = await openOfficeZip(await zipOf({ "a.xml": "<a/>" }));
    await expect(directory.text("a.xml")).resolves.toBe("<a/>");
  });
});

describe("office archives with lying headers", () => {
  it("does not return an entry whose real size is over the entry limit", async () => {
    const buffer = understateSizes(
      await zipOf({ "big.xml": "0".repeat(3 * 1024 * 1024) }),
      100,
    );
    const directory = await openOfficeZip(buffer, {
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
    });
    await expect(directory.read("big.xml")).resolves.toBeUndefined();
  });
});

describe("assertArchiveExpandsWithin", () => {
  it("passes an archive that expands within the limit", async () => {
    await expect(
      assertArchiveExpandsWithin(
        await zipOf({ "a.xml": "x".repeat(1000) }),
        10_000,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses an archive whose entries really expand past the limit", async () => {
    const buffer = understateSizes(
      await zipOf({ "a.xml": "0".repeat(2 * 1024 * 1024) }),
      10,
    );
    await expect(
      assertArchiveExpandsWithin(buffer, 1024 * 1024),
    ).rejects.toThrow(ZipExpansionError);
  });
});
