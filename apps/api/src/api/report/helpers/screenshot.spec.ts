import { buildScreenshotKey, detectScreenshotFormat } from "./screenshot";

const withHeader = (...bytes: number[]) =>
  Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

describe("detectScreenshotFormat", () => {
  it.each([
    [
      "png",
      withHeader(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "image/png",
    ],
    ["jpeg", withHeader(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    [
      "gif",
      Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(16)]),
      "image/gif",
    ],
    [
      "webp",
      Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.alloc(4),
        Buffer.from("WEBP"),
        Buffer.alloc(8),
      ]),
      "image/webp",
    ],
  ])("recognises %s from its bytes", (_name, buffer, mimeType) => {
    expect(detectScreenshotFormat(buffer)?.mimeType).toBe(mimeType);
  });

  it.each([
    ["html", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["plain text", Buffer.from("just some text in a .png")],
    ["a truncated header", Buffer.from([0x89, 0x50, 0x4e])],
    ["a non-WEBP RIFF file", Buffer.from("RIFF\0\0\0\0WAVEfmt ")],
  ])("rejects %s", (_name, buffer) => {
    expect(detectScreenshotFormat(buffer)).toBeUndefined();
  });
});

describe("buildScreenshotKey", () => {
  it("uses a random UUID and the detected extension, never a client name", () => {
    const key = buildScreenshotKey({ mimeType: "image/png", extension: "png" });

    expect(key).toMatch(
      /^issue-screenshots\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.png$/,
    );
    expect(
      buildScreenshotKey({ mimeType: "image/png", extension: "png" }),
    ).not.toBe(key);
  });
});
