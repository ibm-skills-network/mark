/* eslint-disable */
/**
 * describeImagesInSubmission must:
 *  1. describe one picture once, however many blocks carry it (a notebook cell
 *     re-run emits the identical plot every time);
 *  2. release the base64 payload once a description exists, since the rest of
 *     the pipeline reads only the description.
 */

import { CanonicalSubmission } from "src/api/attempt/services/structured-content.models";

function buildService(describeImpl?: jest.Mock) {
  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../evidence-based-grading.service").EvidenceBasedGradingService
      .prototype,
  );

  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const describeImagesForGrading =
    describeImpl ??
    jest.fn(async (blocks: any[]) => {
      const map = new Map<string, string>();
      for (const block of blocks) {
        map.set(block.blockId, `description of ${block.blockId}`);
      }
      return map;
    });

  service.imageDescriptionService = { describeImagesForGrading };
  return { service, describeImagesForGrading };
}

function submissionWith(blocks: any[]): CanonicalSubmission {
  return {
    submissionId: "analysis.ipynb",
    metadata: {
      wordCount: 10,
      pageCount: 1,
      blockCount: blocks.length,
      sourceType: "ipynb",
      checksum: "chk",
      extractedAt: new Date().toISOString(),
    },
    pages: [{ pageNumber: 1, blocks }],
  };
}

const image = (
  blockId: string,
  imageHash?: string,
  imageData = "data:png",
) => ({
  blockId,
  type: "image",
  text: `[Image ${blockId}]`,
  page: 1,
  imageData,
  ...(imageHash ? { imageHash } : {}),
});

const criteria = [{ rubricQuestion: "Does the chart show the trend?" }] as any;

async function run(service: any, submission: CanonicalSubmission) {
  await service.describeImagesInSubmission(submission, criteria, "Q", 1);
  return submission.pages[0].blocks;
}

describe("describeImagesInSubmission - duplicate images", () => {
  it("describes a repeated plot once and shares the result", async () => {
    const { service, describeImagesForGrading } = buildService();
    const blocks = await run(
      service,
      submissionWith([
        image("b1", "hash-a"),
        image("b2", "hash-a"),
        image("b3", "hash-a"),
      ]),
    );

    expect(describeImagesForGrading).toHaveBeenCalledTimes(1);
    expect(describeImagesForGrading.mock.calls[0][0]).toHaveLength(1);
    expect(blocks[0].imageDescription).toBe("description of b1");
    expect(blocks[1].imageDescription).toBe("description of b1");
    expect(blocks[2].imageDescription).toBe("description of b1");
  });

  it("describes distinct plots separately", async () => {
    const { service, describeImagesForGrading } = buildService();
    const blocks = await run(
      service,
      submissionWith([image("b1", "hash-a"), image("b2", "hash-b")]),
    );

    expect(describeImagesForGrading.mock.calls[0][0]).toHaveLength(2);
    expect(blocks[0].imageDescription).toBe("description of b1");
    expect(blocks[1].imageDescription).toBe("description of b2");
  });

  it("never collapses blocks that carry no hash", async () => {
    const { service, describeImagesForGrading } = buildService();
    const blocks = await run(
      service,
      submissionWith([image("b1"), image("b2")]),
    );

    expect(describeImagesForGrading.mock.calls[0][0]).toHaveLength(2);
    expect(blocks[0].imageDescription).toBe("description of b1");
    expect(blocks[1].imageDescription).toBe("description of b2");
  });

  it("shares a failure placeholder across duplicates too", async () => {
    const describeImpl = jest.fn(async (blocks: any[]) => {
      const map = new Map<string, string>();
      for (const block of blocks) {
        map.set(block.blockId, "[Image present but description unavailable]");
      }
      return map;
    });
    const { service } = buildService(describeImpl);
    const blocks = await run(
      service,
      submissionWith([image("b1", "hash-a"), image("b2", "hash-a")]),
    );

    expect(blocks[1].imageDescription).toBe(
      "[Image present but description unavailable]",
    );
  });
});

describe("describeImagesInSubmission - payload release", () => {
  it("drops imageData once a description exists", async () => {
    const { service } = buildService();
    const blocks = await run(
      service,
      submissionWith([image("b1", "hash-a"), image("b2", "hash-a")]),
    );

    expect(blocks[0].imageData).toBeUndefined();
    expect(blocks[1].imageData).toBeUndefined();
    // The description is what chunking and the LLM context actually read.
    expect(blocks[0].imageDescription).toBeDefined();
    expect(blocks[0].imageHash).toBe("hash-a");
  });

  it("records the description on the block declared as its producer", async () => {
    const { service } = buildService();
    const blocks = await run(
      service,
      submissionWith([
        { blockId: "c1", type: "code", text: "df.plot()", page: 1 },
        { ...image("b1", "hash-a"), producedByBlockId: "c1" },
      ]),
    );

    // Chunking folds this into the producing block's chunk text, so a grader
    // citing "df.plot()" cannot infer output the picture contradicts.
    expect(blocks[0].renderedOutputNote).toContain("description of b1");
    expect(blocks[0].renderedOutputNote).toContain(
      "Visual check of this cell's image output",
    );
    // The note must not assert that anything rendered: the grader echoed an
    // earlier "Rendered output" framing back as proof a chart existed and gave
    // full marks to an empty figure.
    expect(blocks[0].renderedOutputNote).not.toContain("Rendered output");
    // Learner-submitted text is never rewritten — evidence quotes are cut from
    // it and shown back to the learner as highlights.
    expect(blocks[0].text).toBe("df.plot()");
    expect(blocks[0].imageDescription).toBeUndefined();
  });

  it("is idempotent across repeated passes", async () => {
    const { service } = buildService();
    const submission = submissionWith([
      { blockId: "c1", type: "code", text: "df.plot()", page: 1 },
      { ...image("b1", "hash-a"), producedByBlockId: "c1" },
    ]);

    await service.describeImagesInSubmission(submission, criteria, "Q", 1);
    const afterFirst = submission.pages[0].blocks[0].renderedOutputNote;
    await service.describeImagesInSubmission(submission, criteria, "Q", 1);

    expect(submission.pages[0].blocks[0].renderedOutputNote).toBe(afterFirst);
    expect(submission.pages[0].blocks[0].text).toBe("df.plot()");
  });

  it("leaves blocks that produced nothing untouched", async () => {
    const { service } = buildService();
    const blocks = await run(
      service,
      submissionWith([
        { blockId: "c1", type: "code", text: "import pandas as pd", page: 1 },
        { blockId: "c2", type: "code", text: "df.plot()", page: 1 },
        { ...image("b1", "hash-a"), producedByBlockId: "c2" },
      ]),
    );

    expect(blocks[0].renderedOutputNote).toBeUndefined();
    expect(blocks[1].renderedOutputNote).toContain("description of b1");
  });

  /**
   * PDF pages are laid out as every text block followed by every image
   * (PdfStructureExtractorService), with no producer relationship. Attaching by
   * adjacency glued every figure on a page onto its last paragraph.
   */
  it("attaches nothing when no producer is declared (PDF layout)", async () => {
    const { service } = buildService();
    const blocks = await run(
      service,
      submissionWith([
        { blockId: "p1", type: "paragraph", text: "Intro paragraph", page: 1 },
        { blockId: "p2", type: "paragraph", text: "Final paragraph", page: 1 },
        image("i1", "hash-a"),
        image("i2", "hash-b"),
      ]),
    );

    expect(blocks[0].renderedOutputNote).toBeUndefined();
    expect(blocks[1].renderedOutputNote).toBeUndefined();
    expect(blocks[1].text).toBe("Final paragraph");
    // The images still carry their own descriptions for direct citation.
    expect(blocks[2].imageDescription).toBeDefined();
    expect(blocks[3].imageDescription).toBeDefined();
  });

  it("ignores a producer link that points at another image", async () => {
    const { service } = buildService();
    const blocks = await run(
      service,
      submissionWith([
        image("b1", "hash-a"),
        { ...image("b2", "hash-b"), producedByBlockId: "b1" },
      ]),
    );

    expect(blocks[0].renderedOutputNote).toBeUndefined();
  });

  it("does nothing when the submission has no images", async () => {
    const { service, describeImagesForGrading } = buildService();
    await run(
      service,
      submissionWith([
        { blockId: "c1", type: "code", text: "print(1)", page: 1 },
      ]),
    );

    expect(describeImagesForGrading).not.toHaveBeenCalled();
  });
});
