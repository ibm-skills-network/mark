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
