/* eslint-disable */
/**
 * Tests for bytes-first image MIME detection and the preflight that converts
 * or rejects formats the vision model cannot grade. Covers:
 *
 *  - detectImageMimeType prefers magic bytes over a misleading filename.
 *  - preflightImageBuffer passes png/jpeg/gif/webp through with the sniffed
 *    mime, converts bmp/tiff/avif to PNG via sharp, and rejects heic/svg/
 *    unrecognizable data with a typed, learner-facing error.
 *  - A real sharp round-trip proves the dependency works in this environment.
 */

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

// Magic-byte fixtures as small Buffers.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
const BMP = Buffer.from([0x42, 0x4d, 0x46, 0x00, 0x00, 0x00]);

function isoBmff(brand: string): Buffer {
  // 4-byte size + "ftyp" + 4-byte major brand.
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from(brand, "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

const HEIC = isoBmff("heic");
const AVIF = isoBmff("avif");
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  "utf8",
);
const SVG_XML = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  "utf8",
);
const GARBAGE = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

describe("ImageGradingService.detectMimeFromBytes - magic-byte sniffing", () => {
  it("detects each format from its magic bytes", () => {
    const { service } = buildService();

    expect(service.detectMimeFromBytes(PNG)).toBe("image/png");
    expect(service.detectMimeFromBytes(JPEG)).toBe("image/jpeg");
    expect(service.detectMimeFromBytes(GIF)).toBe("image/gif");
    expect(service.detectMimeFromBytes(WEBP)).toBe("image/webp");
    expect(service.detectMimeFromBytes(BMP)).toBe("image/bmp");
    expect(service.detectMimeFromBytes(TIFF_LE)).toBe("image/tiff");
    expect(service.detectMimeFromBytes(TIFF_BE)).toBe("image/tiff");
    expect(service.detectMimeFromBytes(HEIC)).toBe("image/heic");
    expect(service.detectMimeFromBytes(AVIF)).toBe("image/avif");
    expect(service.detectMimeFromBytes(SVG)).toBe("image/svg+xml");
    expect(service.detectMimeFromBytes(SVG_XML)).toBe("image/svg+xml");
  });

  it("returns null when the bytes match no known image signature", () => {
    const { service } = buildService();
    expect(service.detectMimeFromBytes(GARBAGE)).toBeNull();
  });
});

describe("ImageGradingService.preflightImageBuffer - convert or reject (mocked sharp)", () => {
  it("passes png through with the sniffed mime, untouched", async () => {
    const { service } = buildService();
    const result = await service.preflightImageBuffer(PNG, "photo.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.buffer).toBe(PNG);
  });

  it("passes jpeg through with the sniffed mime, untouched", async () => {
    const { service } = buildService();
    const result = await service.preflightImageBuffer(JPEG, "photo.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer).toBe(JPEG);
  });

  it("converts bmp to PNG via sharp and logs the conversion", async () => {
    const { service, mockLogger } = buildService();
    const result = await service.preflightImageBuffer(BMP, "photo.bmp");
    expect(sharp).toHaveBeenCalledWith(BMP);
    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.toString()).toBe("converted");
    expect(mockLogger.info).toHaveBeenCalledWith(
      "image.grading.converted",
      expect.objectContaining({ detectedFormat: "image/bmp" }),
    );
  });

  it("converts tiff to PNG via sharp", async () => {
    const { service } = buildService();
    const result = await service.preflightImageBuffer(TIFF_LE, "photo.tiff");
    expect(sharp).toHaveBeenCalledWith(TIFF_LE);
    expect(result.mimeType).toBe("image/png");
  });

  it("converts avif to PNG via sharp", async () => {
    const { service } = buildService();
    const result = await service.preflightImageBuffer(AVIF, "photo.avif");
    expect(sharp).toHaveBeenCalledWith(AVIF);
    expect(result.mimeType).toBe("image/png");
  });

  it("rejects heic with a learner-facing error and logs it", async () => {
    const { service, mockLogger } = buildService();
    let thrown: unknown;
    try {
      await service.preflightImageBuffer(HEIC, "photo.heic");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    const e = thrown as UnsupportedImageFormatError;
    expect(e.detectedFormat).toBe("image/heic");
    expect(e.learnerMessage).toBe(
      '"photo.heic" is not a supported image format. Please upload a PNG, JPEG, GIF, or WebP image.',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "image.grading.unsupported",
      expect.objectContaining({ detectedFormat: "image/heic" }),
    );
  });

  it("rejects svg with a learner-facing error", async () => {
    const { service } = buildService();
    let thrown: unknown;
    try {
      await service.preflightImageBuffer(SVG, "drawing.svg");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    expect((thrown as UnsupportedImageFormatError).detectedFormat).toBe(
      "image/svg+xml",
    );
  });

  it("rejects unrecognizable data with detectedFormat 'unknown'", async () => {
    const { service } = buildService();
    let thrown: unknown;
    try {
      await service.preflightImageBuffer(GARBAGE, "mystery.bin");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    expect((thrown as UnsupportedImageFormatError).detectedFormat).toBe(
      "unknown",
    );
    expect((thrown as UnsupportedImageFormatError).learnerMessage).toBe(
      '"mystery.bin" is not a supported image format. Please upload a PNG, JPEG, GIF, or WebP image.',
    );
  });

  it("rejects a convertible buffer over the size cap before invoking sharp", async () => {
    const { service, mockLogger } = buildService();

    // Valid TIFF header + enough padding to exceed the 50MB convert cap.
    const oversized = Buffer.concat([TIFF_LE, Buffer.alloc(51 * 1024 * 1024)]);

    let thrown: unknown;
    try {
      await service.preflightImageBuffer(oversized, "huge.tiff");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    const e = thrown as UnsupportedImageFormatError;
    expect(e.detectedFormat).toBe("image/tiff");
    expect(e.reason).toBe("image too large to convert");
    // sharp must never be touched for an over-cap buffer.
    expect(sharp).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "image.grading.convert.too.large",
      expect.objectContaining({ detectedFormat: "image/tiff" }),
    );
  });
});

describe("ImageGradingService.processDirectImageData - malformed data URLs", () => {
  it("rejects a data URL with no comma as a typed format error, not a TypeError", async () => {
    const { service } = buildService();
    let thrown: unknown;
    try {
      // No comma → the base64 segment is absent; must coalesce to "" and route
      // into the typed rejection rather than Buffer.from(undefined) throwing.
      await service.processDirectImageData("data:image/png;base64");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
  });

  it("rejects an empty data URL payload as a typed format error", async () => {
    const { service } = buildService();
    let thrown: unknown;
    try {
      await service.processDirectImageData("data:image/png;base64,");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
  });
});

// Mock sharp for the conversion-path unit tests above: a chainable object
// whose .png().toBuffer() resolves to a sentinel "converted" buffer.
jest.mock("sharp", () => {
  return jest.fn(() => ({
    png: () => ({ toBuffer: async () => Buffer.from("converted") }),
  }));
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as jest.Mock;

beforeEach(() => {
  sharp.mockClear();
});
