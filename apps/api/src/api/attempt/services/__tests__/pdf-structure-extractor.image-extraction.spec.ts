/* eslint-disable */
/**
 * Image extraction must not depend on rendering the page to a canvas.
 *
 * The full-page page.render() call in extractImagesFromPage was dead work —
 * its canvas output was never read — AND it was the native-crash trigger
 * (SIGSEGV / "Image or Canvas expected" under pdfjs v5, plus the unhandled
 * AbortException that exited workers). Image data is pulled from the operator
 * list + page.objs, so extraction must work without ever invoking
 * page.render().
 */
import { PdfStructureExtractorService } from "../pdf-structure-extractor.service";

function buildExtractor() {
  const mockLogger = {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const extractor = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PdfStructureExtractorService.prototype,
  );
  extractor.logger = mockLogger;
  return { extractor, mockLogger };
}

function buildMockPage(overrides: Record<string, unknown> = {}) {
  return {
    getViewport: jest.fn(() => ({ width: 10, height: 10, rotation: 0 })),
    // If this is ever called, the test fails — rendering is the crash path.
    render: jest.fn(() => ({ promise: Promise.resolve() })),
    // 85 / 88 are the paintImageXObject opcodes the extractor scans for.
    getOperatorList: jest.fn(async () => ({
      fnArray: [85],
      argsArray: [["img1"]],
    })),
    objs: {
      has: (name: string) => name === "img1",
      get: (name: string) =>
        name === "img1"
          ? {
              data: new Uint8ClampedArray([255, 0, 0]),
              width: 1,
              height: 1,
              kind: 2,
            }
          : undefined,
    },
    ...overrides,
  };
}

describe("PdfStructureExtractorService image extraction (no canvas render)", () => {
  it("extracts an image via the operator list WITHOUT invoking page.render()", async () => {
    const { extractor } = buildExtractor();
    const page = buildMockPage();
    const warnings: string[] = [];

    // Pixel→base64 conversion (node-canvas) is a separate concern from the
    // extraction path under test; stub it so the assertion is deterministic
    // and focused on "image found via operator list + page.objs, no render".
    const convertSpy = jest
      .spyOn(extractor, "convertImageToBase64")
      .mockResolvedValue({
        imageData: "data:image/png;base64,AAA",
        format: "png",
        width: 1,
        height: 1,
      });

    const blocks = await extractor.extractImagesFromPage(page, 1, warnings);

    // The crash path (full-page canvas render) must never be invoked.
    expect(page.render).not.toHaveBeenCalled();
    // The image is still discovered via the operator list + page.objs and
    // turned into a block.
    expect(convertSpy).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].page).toBe(1);
  });

  it("returns no image blocks (and does not render) when the page has no images", async () => {
    const { extractor } = buildExtractor();
    const page = buildMockPage({
      getOperatorList: jest.fn(async () => ({ fnArray: [], argsArray: [] })),
    });
    const warnings: string[] = [];

    const blocks = await extractor.extractImagesFromPage(page, 2, warnings);

    expect(page.render).not.toHaveBeenCalled();
    expect(blocks).toHaveLength(0);
  });
});
