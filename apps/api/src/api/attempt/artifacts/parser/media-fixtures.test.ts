import * as zlib from "node:zlib";
interface CraftedFile {
  path: string;
  content: string | Buffer;
  /**
   * What the central directory should claim the part inflates to. Real zip
   * writers put the truth here; nothing in the format makes them.
   */
  declaredUncompressedSize?: number;
}

/**
 * Write a zip by hand so the central directory can disagree with the deflate
 * stream it points at. Every zip library writes honest sizes, which is exactly
 * the assumption under test.
 */
export function craftMediaZip(files: CraftedFile[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const raw =
      typeof file.content === "string"
        ? Buffer.from(file.content, "utf8")
        : file.content;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw) >>> 0;
    const declared = file.declaredUncompressedSize ?? raw.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04_03_4b_50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(deflated.length, 18);
    localHeader.writeUInt32LE(declared, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localChunks.push(localHeader, name, deflated);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02_01_4b_50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(deflated.length, 20);
    centralHeader.writeUInt32LE(declared, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralChunks.push(centralHeader, name);

    localOffset += 30 + name.length + deflated.length;
  }

  const locals = Buffer.concat(localChunks);
  const central = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06_05_4b_50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(central.length, 12);
  endRecord.writeUInt32LE(locals.length, 16);

  return Buffer.concat([locals, central, endRecord]);
}
