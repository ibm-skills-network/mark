/* eslint-disable */
/**
 * Images embedded in a PDF must actually reach the grader.
 *
 * pdfjs publishes image objects on page.objs asynchronously, AFTER
 * getOperatorList() resolves. The extractor used to test page.objs.has()
 * synchronously right after awaiting the operator list, so on a real
 * submission every embedded diagram was dropped — silently, at debug level,
 * leaving `warnings` empty so extraction still reported "high" quality.
 *
 * It also matched only the two literal opcodes for paintImageXObject /
 * paintImageXObjectRepeat, so image masks (what monochrome diagram exports
 * commonly produce) and inline images were never even looked at.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfStructureExtractorService } from "../pdf-structure-extractor.service";
import {
  MAX_IMAGES_PER_PAGE,
  MAX_IMAGE_PIXELS,
} from "../pdf-structure-extractor.service";

const { OPS } = pdfjs as unknown as { OPS: Record<string, number> };

type MockLogger = {
  log: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function buildExtractor(): { extractor: any; mockLogger: MockLogger } {
  const mockLogger: MockLogger = {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const extractor = Object.create(PdfStructureExtractorService.prototype);
  extractor.logger = mockLogger;
  // node-canvas is stubbed in this test environment; pixel conversion is a
  // separate concern from "did the extractor find and await the image".
  extractor.convertImageToBase64 = jest.fn(
    async (image: { width: number; height: number }) => ({
      imageData: "data:image/png;base64,AAA",
      format: "png",
      width: image.width,
      height: image.height,
    }),
  );
  return { extractor, mockLogger };
}

/**
 * Models pdfjs's PDFObjects: `has` is false until the worker publishes the
 * object, and `get(id, callback)` registers a callback that fires on arrival.
 */
function deferredObjs(
  entries: Record<string, unknown>,
  delayMs = 5,
): { has: (id: string) => boolean; get: (id: string, cb?: any) => unknown } {
  const resolved = new Set<string>();
  const waiting: Array<[string, (value: unknown) => void]> = [];
  const timer = setTimeout(() => {
    for (const id of Object.keys(entries)) resolved.add(id);
    for (const [id, callback] of waiting) {
      if (id in entries) callback(entries[id]);
    }
    waiting.length = 0;
  }, delayMs);
  // Never hold the jest worker open for a store that resolves after the test.
  timer.unref?.();

  return {
    has: (id: string) => resolved.has(id),
    get: (id: string, callback?: (value: unknown) => void) => {
      if (callback) {
        if (resolved.has(id)) callback(entries[id]);
        else waiting.push([id, callback]);
        return null;
      }
      if (!resolved.has(id)) {
        throw new Error(`Requesting object that isn't resolved yet ${id}.`);
      }
      return entries[id];
    },
  };
}

function rasterImage(width = 2, height = 2) {
  return {
    data: new Uint8ClampedArray(width * height * 3).fill(120),
    width,
    height,
    kind: 2,
  };
}

function maskImage(width = 8, height = 4) {
  return {
    data: new Uint8Array((((width + 7) >> 3) * height) as number).fill(0xf0),
    width,
    height,
    interpolate: false,
  };
}

function buildPage(
  fnArray: number[],
  argsArray: unknown[],
  objects: Record<string, unknown>,
  delayMs = 5,
) {
  return {
    getViewport: () => ({ width: 612, height: 792, rotation: 0 }),
    render: jest.fn(() => ({ promise: Promise.resolve() })),
    getOperatorList: jest.fn(async () => ({ fnArray, argsArray })),
    objs: deferredObjs(objects, delayMs),
    commonObjs: deferredObjs({}, delayMs),
  };
}

describe("awaiting image objects published after the operator list", () => {
  it("extracts an image that the worker publishes after getOperatorList resolves", async () => {
    const { extractor } = buildExtractor();
    const page = buildPage(
      [OPS.paintImageXObject],
      [["img_p0_1", 2, 2]],
      { img_p0_1: rasterImage() },
      5,
    );
    const warnings: string[] = [];

    // The bug: at this instant page.objs.has("img_p0_1") is still false.
    expect(page.objs.has("img_p0_1")).toBe(false);

    const blocks = await extractor.extractImagesFromPage(page, 2, warnings);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].page).toBe(2);
    expect(blocks[0].imageData).toContain("data:image/png;base64,");
    expect(page.render).not.toHaveBeenCalled();
  });

  it("falls back to the shared object store for globally cached images", async () => {
    const { extractor } = buildExtractor();
    const page = buildPage(
      [OPS.paintImageXObject],
      [["d0_img_p0_1", 2, 2]],
      {},
    );
    page.commonObjs = deferredObjs({ d0_img_p0_1: rasterImage() }, 5);
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    expect(blocks).toHaveLength(1);
  });

  it("records a warning instead of a silent debug line when an image never resolves", async () => {
    process.env.PDF_IMAGE_RESOLVE_TIMEOUT_MS = "20";
    try {
      const { extractor, mockLogger } = buildExtractor();
      const page = buildPage(
        [OPS.paintImageXObject],
        [["img_p0_1", 2, 2]],
        {},
        100_000,
      );
      const warnings: string[] = [];

      const blocks = await extractor.extractImagesFromPage(page, 3, warnings);

      expect(blocks).toHaveLength(0);
      expect(warnings.length).toBeGreaterThan(0);
      expect(mockLogger.warn).toHaveBeenCalled();
    } finally {
      delete process.env.PDF_IMAGE_RESOLVE_TIMEOUT_MS;
    }
  });
});

describe("image operator coverage", () => {
  it("collects every image-painting operator, not only paintImageXObject", async () => {
    const { extractor } = buildExtractor();
    const fnArray = [
      OPS.paintImageXObject,
      OPS.paintImageXObjectRepeat,
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintImageMaskXObjectRepeat,
      OPS.paintInlineImageXObject,
      OPS.paintInlineImageXObjectGroup,
      OPS.paintSolidColorImageMask,
    ];
    const argsArray: unknown[] = [
      ["img_a", 2, 2],
      ["img_b", 1, 1, new Float32Array([0, 0])],
      [{ data: "mask_c", width: 8, height: 4, interpolate: false, count: 1 }],
      [
        [
          { data: "mask_d", width: 8, height: 4 },
          { data: "mask_e", width: 8, height: 4 },
        ],
      ],
      [{ data: "mask_f", width: 8, height: 4 }, 1, 0, 0, 1, new Float32Array()],
      [rasterImage(3, 3)],
      [rasterImage(4, 4), []],
      [],
    ];
    const page = buildPage(fnArray, argsArray, {
      img_a: rasterImage(),
      img_b: rasterImage(),
      mask_c: maskImage(),
      mask_d: maskImage(),
      mask_e: maskImage(),
      mask_f: maskImage(),
    });
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    // 2 raster XObjects + 4 masks + 2 inline images. The solid-colour mask
    // carries no picture and is deliberately not turned into a block.
    expect(blocks).toHaveLength(8);
  });

  it("extracts a repeated image object once per page", async () => {
    const { extractor } = buildExtractor();
    const page = buildPage(
      [OPS.paintImageXObject, OPS.paintImageXObject],
      [
        ["img_a", 2, 2],
        ["img_a", 2, 2],
      ],
      { img_a: rasterImage() },
    );
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    expect(blocks).toHaveLength(1);
  });
});

describe("per-page image extraction logging", () => {
  it("logs at info how many images were extracted from the page", async () => {
    const { extractor, mockLogger } = buildExtractor();
    const page = buildPage(
      [OPS.paintImageXObject, OPS.paintImageXObject],
      [
        ["img_a", 2, 2],
        ["img_b", 2, 2],
      ],
      { img_a: rasterImage(), img_b: rasterImage() },
    );

    await extractor.extractImagesFromPage(page, 4, []);

    const line = mockLogger.log.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.startsWith("pdf.images.extracted"));

    expect(line).toBeDefined();
    const payload = JSON.parse(line!.replace("pdf.images.extracted ", ""));
    expect(payload.page).toBe(4);
    expect(payload.extracted).toBe(2);
    expect(payload.imageOperators).toBe(2);
  });

  it("does not log an image line for a page with no images", async () => {
    const { extractor, mockLogger } = buildExtractor();
    const page = buildPage([], [], {});

    await extractor.extractImagesFromPage(page, 1, []);

    expect(
      mockLogger.log.mock.calls
        .map((call) => String(call[0]))
        .some((message) => message.startsWith("pdf.images.extracted")),
    ).toBe(false);
  });
});

describe("memory bounds", () => {
  it("stops after the per-page image cap and reports the drop", async () => {
    const { extractor, mockLogger } = buildExtractor();
    const count = MAX_IMAGES_PER_PAGE + 5;
    const fnArray: number[] = [];
    const argsArray: unknown[] = [];
    const objects: Record<string, unknown> = {};
    for (let index = 0; index < count; index++) {
      fnArray.push(OPS.paintImageXObject);
      argsArray.push([`img_${index}`, 2, 2]);
      objects[`img_${index}`] = rasterImage();
    }
    const page = buildPage(fnArray, argsArray, objects);
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    expect(blocks).toHaveLength(MAX_IMAGES_PER_PAGE);
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("skips an image whose pixel count exceeds the conversion budget", async () => {
    const { extractor, mockLogger } = buildExtractor();
    const oversized = {
      data: new Uint8ClampedArray(12),
      width: MAX_IMAGE_PIXELS,
      height: 2,
      kind: 2,
    };
    const page = buildPage(
      [OPS.paintImageXObject],
      [["img_big", oversized.width, oversized.height]],
      { img_big: oversized },
    );
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    expect(blocks).toHaveLength(0);
    expect(extractor.convertImageToBase64).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("honours a document-wide image budget shared across pages", async () => {
    const { extractor } = buildExtractor();
    const budget = { remaining: 1 };
    const makePage = () =>
      buildPage([OPS.paintImageXObject], [["img_a", 2, 2]], {
        img_a: rasterImage(),
      });

    const first = await extractor.extractImagesFromPage(
      makePage(),
      1,
      [],
      budget,
    );
    const second = await extractor.extractImagesFromPage(
      makePage(),
      2,
      [],
      budget,
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
