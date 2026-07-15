/* eslint-disable */
/**
 * Proves the real sharp dependency actually converts an unsupported-but-
 * convertible format to PNG in this environment. No mocking — this is the
 * end-to-end proof that the conversion path is not a stub. sharp creates a
 * tiny real TIFF fixture, which preflight then converts to PNG; the result
 * must start with the PNG magic-byte signature.
 */

import sharp from "sharp";
import { UnsupportedImageFormatError } from "../../errors/unsupported-image-format.error";

function buildService() {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../image-grading.service").ImageGradingService.prototype,
  );
  service.logger = mockLogger;
  return { service, mockLogger };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("preflightImageBuffer - real sharp conversion", () => {
  it("converts a real TIFF buffer to a real PNG buffer", async () => {
    const { service } = buildService();

    // Build a real 2x2 TIFF using sharp itself, then preflight it.
    const tiff = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .tiff()
      .toBuffer();

    // Sanity: the crafted buffer really is a TIFF by magic bytes.
    expect(service.detectMimeFromBytes(tiff)).toBe("image/tiff");

    const result = await service.preflightImageBuffer(tiff, "fixture.tiff");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it("downscales an oversized PNG so it stays under the vision provider's limits", async () => {
    const { service } = buildService();

    // A 4000px-wide PNG — larger than the 1568px long-edge cap, the size that
    // makes a real screenshot upload come back as "unsupported format".
    const bigPng = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    expect(service.detectMimeFromBytes(bigPng)).toBe("image/png");

    const result = await service.preflightImageBuffer(bigPng, "screenshot.png");

    expect(result.mimeType).toBe("image/png");
    const meta = await sharp(result.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      1568,
    );
  });

  it("passes a small PNG through untouched", async () => {
    const { service } = buildService();
    const smallPng = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();

    const result = await service.preflightImageBuffer(smallPng, "small.png");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer).toBe(smallPng);
  });

  it("re-encodes an under-dimension but over-byte image as JPEG below the byte cap", async () => {
    const { service } = buildService();

    const MAX_BYTES = 4 * 1024 * 1024;

    // 1500px square of incompressible pseudo-noise: within the 1568px edge cap
    // but far past the 4MB byte cap as lossless PNG. The dimension clamp alone
    // can't shrink it, so preflight must fall back to a lossy encoder to land
    // the image under the provider's per-image byte ceiling.
    const px = 1500 * 1500 * 3;
    const raw = Buffer.allocUnsafe(px);
    let s = 0x12345678;
    for (let i = 0; i < px; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      raw[i] = s & 0xff;
    }
    const noisyPng = await sharp(raw, {
      raw: { width: 1500, height: 1500, channels: 3 },
    })
      .png()
      .toBuffer();

    expect(service.detectMimeFromBytes(noisyPng)).toBe("image/png");
    // Sanity: the fixture really is over the cap yet within the edge limit.
    expect(noisyPng.length).toBeGreaterThan(MAX_BYTES);

    const result = await service.preflightImageBuffer(noisyPng, "dense.png");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.length).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("keeps a downscaled image as lossless PNG when it fits under the byte cap", async () => {
    const { service } = buildService();

    // Oversized dimensions but ordinary content: the fit-inside-1568 clamp
    // brings it under the byte cap as PNG, so it must stay lossless PNG rather
    // than needlessly dropping to JPEG.
    const bigPng = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const result = await service.preflightImageBuffer(bigPng, "screenshot.png");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.length).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("rejects genuinely unsupported data without invoking sharp conversion", async () => {
    const { service } = buildService();
    await expect(
      service.preflightImageBuffer(
        Buffer.from("not an image at all", "utf8"),
        "mystery.bin",
      ),
    ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
  });

  it("rejects a corrupted-but-sniffable TIFF with a typed decode error, not a raw sharp throw", async () => {
    const { service, mockLogger } = buildService();

    // A valid little-endian TIFF header followed by garbage: sniffs as TIFF
    // (so it enters the convert branch) but sharp cannot decode it.
    const corruptTiff = Buffer.concat([
      Buffer.from([0x49, 0x49, 0x2a, 0x00]),
      Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]),
    ]);
    expect(service.detectMimeFromBytes(corruptTiff)).toBe("image/tiff");

    let thrown: unknown;
    try {
      await service.preflightImageBuffer(corruptTiff, "broken.tiff");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    const e = thrown as UnsupportedImageFormatError;
    expect(e.detectedFormat).toBe("image/tiff");
    expect(e.reason).toBe("image data could not be decoded for conversion");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "image.grading.convert.failed",
      expect.objectContaining({ detectedFormat: "image/tiff" }),
    );
  });
});
