import sharp from "sharp";
import JSZip from "jszip";
import { extractNotebook } from "./adapter-notebook";
import { extractArchive } from "./adapter-archive";
import { readBoundedZip } from "./bounded-zip";
const limits = {
  inputBytes: 1048576,
  expandedBytes: 1048576,
  outputBytes: 2097152,
};
const notebook = (cells: unknown[]) =>
  Buffer.from(JSON.stringify({ nbformat: 4, cells }));
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const zip = async (entries: Record<string, string | Buffer>) => {
  const archive = new JSZip();
  for (const [path, bytes] of Object.entries(entries))
    archive.file(path, bytes);
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};
describe("canonical notebook", () => {
  it("preserves late content, zero and deduplicated plot resources", async () => {
    const image = (
      await sharp({
        create: { width: 1, height: 1, channels: 3, background: "red" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    const source = `${"a".repeat(300)} decisive answer`;
    const result = await extractNotebook(
      notebook([
        {
          cell_type: "code",
          source,
          outputs: [
            {
              output_type: "execute_result",
              data: { "text/plain": "0", "image/png": image },
            },
            { output_type: "display_data", data: { "image/png": image } },
          ],
        },
      ]),
      limits,
    );
    expect(result.blocks[0].text).toBe(source);
    expect(result.blocks[1].text).toBe("0");
    expect(result.blocks[2].resourceRef).toBe(result.blocks[3].resourceRef);
    expect(result.resources).toHaveLength(1);
  });
  it("rejects a truncated raster even when its header looks valid", async () => {
    await expect(
      extractNotebook(
        notebook([
          {
            cell_type: "code",
            source: "",
            outputs: [
              { output_type: "display_data", data: { "image/png": image } },
            ],
          },
        ]),
        limits,
      ),
    ).rejects.toThrow("corrupt_input");
  });
  it("records unsupported visuals", async () => {
    const result = await extractNotebook(
      notebook([
        {
          cell_type: "code",
          source: "plot()",
          outputs: [
            {
              output_type: "display_data",
              data: { "image/svg+xml": "<svg/>" },
            },
          ],
        },
      ]),
      limits,
    );
    expect(result.omissions[0].code).toBe("unsupported_feature");
  });
  it.each([
    Buffer.from("{"),
    notebook([{ cell_type: "code", source: 4, outputs: [] }]),
    notebook([
      { cell_type: "code", source: "", outputs: [{ output_type: "unknown" }] },
    ]),
  ])("rejects malformed shape", async (bytes) => {
    await expect(extractNotebook(bytes, limits)).rejects.toThrow(
      "corrupt_input",
    );
  });
  it("distinguishes empty and rejects excessive output", async () => {
    expect((await extractNotebook(notebook([]), limits)).empty).toBe(true);
    await expect(
      extractNotebook(
        notebook([{ cell_type: "markdown", source: "x".repeat(500) }]),
        { ...limits, expandedBytes: 100 },
      ),
    ).rejects.toThrow("expansion_limit");
  });
});
describe("canonical ZIP", () => {
  it("preserves second file and locations with explicit binary omissions", async () => {
    const text = `${"x".repeat(300)}\ndecisive second file`;
    const result = await extractArchive(
      await zip({
        "main.py": "print(0)",
        "src/answer.py": text,
        "image.png": Buffer.from([0, 1]),
      }),
      limits,
    );
    expect(result.blocks[1]).toMatchObject({
      text,
      location: { archivePath: "src/answer.py", lineStart: 1, lineEnd: 2 },
    });
    expect(result.omissions[0].code).toBe("unsupported_feature");
  });
  it("rejects traversal and symlinks", async () => {
    await expect(
      extractArchive(await zip({ "../escape.py": "x" }), limits),
    ).rejects.toThrow("corrupt_input");
    const archive = new JSZip();
    archive.file("link.py", "outside", { unixPermissions: 0o120777 });
    await expect(
      extractArchive(
        await archive.generateAsync({ type: "nodebuffer", platform: "UNIX" }),
        limits,
      ),
    ).rejects.toThrow("corrupt_input");
  });
  it("bounds expansion, file count and path depth", async () => {
    const bytes = await zip({ "src/answer.py": "x".repeat(1000) });
    await expect(
      extractArchive(bytes, { ...limits, expandedBytes: 100 }),
    ).rejects.toThrow("expansion_limit");
    await expect(
      readBoundedZip(bytes, { expandedBytes: 5000, files: 1 }),
    ).rejects.toThrow("expansion_limit");
    await expect(
      readBoundedZip(bytes, { expandedBytes: 5000, nesting: 1 }),
    ).rejects.toThrow("expansion_limit");
  });
  it("checks actual inflation even when the directory lies about size", async () => {
    const bytes = await zip({ "answer.py": "x".repeat(1000) });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1, central + 24);
    await expect(
      extractArchive(bytes, { ...limits, expandedBytes: 100 }),
    ).rejects.toThrow("expansion_limit");
  });
  it("rejects checksum corruption instead of returning plausible text", async () => {
    const bytes = await zip({ "answer.py": "print(1)" });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(0, central + 16);
    await expect(extractArchive(bytes, limits)).rejects.toThrow(
      "corrupt_input",
    );
  });
  it("reports encrypted archives as unsupported", async () => {
    const bytes = await zip({ "answer.py": "print(1)" });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(1, central + 8);
    await expect(extractArchive(bytes, limits)).rejects.toThrow(
      "unsupported_format",
    );
  });
  it("rejects corruption and distinguishes empty", async () => {
    await expect(
      extractArchive(Buffer.from("not a zip"), limits),
    ).rejects.toThrow("corrupt_input");
    expect((await extractArchive(await zip({}), limits)).empty).toBe(true);
  });
});
