/* eslint-disable */
/**
 * Service-flow regression test for criteria-based image grading.
 *
 * Criteria-based grading consumes OCR evidence extracted from the learner's
 * images, never the image bytes themselves. It must therefore neither fetch
 * the primary image from storage nor preflight it — a COS-stored HEIC that the
 * vision model could not grade still grades fine here off its OCR text. This
 * asserts the storage fetch (s3.getObject) is never invoked for a CRITERIA_BASED
 * request whose only image lives in COS ("InCos").
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

  const getObject = jest.fn();
  service.s3Service = { getObject };

  service.moderationService = {
    validateContent: jest.fn().mockResolvedValue(true),
  };
  service.chunkingService = {
    extractFromImages: jest
      .fn()
      .mockReturnValue([
        { id: "c1", text: "extracted ocr text", source: "img" },
      ]),
  };
  service.evidencePipeline = {
    gradeWithEvidence: jest.fn().mockResolvedValue({
      grades: [
        {
          rubricQuestion: "Clarity",
          pointsAwarded: 4,
          maxPoints: 5,
          rationale: "clear",
        },
      ],
      summary: { totalPoints: 4, maxPoints: 5 },
      audit: null,
    }),
  };

  return { service, getObject, mockLogger };
}

describe("ImageGradingService.gradeImageBasedQuestion - CRITERIA_BASED skips storage/preflight", () => {
  it("does NOT fetch or preflight a COS HEIC image for criteria-based grading", async () => {
    const { service, getObject } = buildService();

    const model = {
      question: "Describe the diagram",
      imageData: "",
      imageBucket: "",
      imageKey: "",
      learnerResponse: "my answer",
      totalPoints: 5,
      scoringCriteriaType: "CRITERIA_BASED",
      scoringCriteria: {
        type: "CRITERIA_BASED",
        rubrics: [
          {
            rubricQuestion: "Clarity",
            criteria: [{ description: "clear", points: 5 }],
          },
        ],
      },
      previousQuestionsAnswersContext: [],
      assignmentInstrctions: "",
      // The only image lives in COS — its bytes are never needed here.
      learnerImageResponse: [
        {
          filename: "IMG_1234.heic",
          imageData: "InCos",
          imageKey: "assignments/9f8a-uuid-IMG_1234.heic",
          imageBucket: "submissions",
          imageUrl: "",
          mimeType: "image/heic",
        },
      ],
    };

    const result = await service.gradeImageBasedQuestion(model, 1);

    // Storage must never be touched: criteria-based grading reads OCR evidence.
    expect(getObject).not.toHaveBeenCalled();
    expect(service.evidencePipeline.gradeWithEvidence).toHaveBeenCalledTimes(1);
    expect(result.points).toBe(4);
  });

  it("propagates a preflight rejection only on the non-criteria (vision) path", async () => {
    const { service, getObject } = buildService();

    // A non-criteria request with a COS HEIC: this path DOES need the bytes, so
    // it fetches + preflights, and the HEIC is rejected. Proves the skip above
    // is specific to the criteria branch, not a blanket no-op.
    getObject.mockResolvedValue({
      Body: Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from("ftyp", "ascii"),
        Buffer.from("heic", "ascii"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
      ]),
    });

    const model = {
      question: "Describe the photo",
      imageData: "",
      imageBucket: "",
      imageKey: "",
      learnerResponse: "my answer",
      totalPoints: 5,
      scoringCriteriaType: "AI_GRADED",
      scoringCriteria: { type: "AI_GRADED", rubrics: [] },
      previousQuestionsAnswersContext: [],
      assignmentInstrctions: "",
      learnerImageResponse: [
        {
          filename: "IMG_1234.heic",
          imageData: "InCos",
          imageKey: "assignments/9f8a-uuid-IMG_1234.heic",
          imageBucket: "submissions",
          imageUrl: "",
          mimeType: "image/heic",
        },
      ],
    };

    await expect(
      service.gradeImageBasedQuestion(model, 1),
    ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
    expect(getObject).toHaveBeenCalledTimes(1);
  });
});

describe("ImageGradingService.getPrimaryImageForGrading - learner filename, not COS key", () => {
  it("surfaces the submission filename in the rejection, never the storage key", async () => {
    const { service, getObject } = buildService();

    getObject.mockResolvedValue({
      Body: Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from("ftyp", "ascii"),
        Buffer.from("heic", "ascii"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
      ]),
    });

    const learnerImages = [
      {
        filename: "IMG.heic",
        imageData: "InCos",
        imageKey: "prefix/uuid-IMG.heic",
        imageBucket: "submissions",
        imageUrl: "",
        mimeType: "image/heic",
        imageAnalysisResult: {
          width: 0,
          height: 0,
          aspectRatio: 0,
          fileSize: 0,
        },
      },
    ];

    let thrown: unknown;
    try {
      await service.getPrimaryImageForGrading("", "", "", learnerImages);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnsupportedImageFormatError);
    const e = thrown as UnsupportedImageFormatError;
    expect(e.learnerMessage).toContain("IMG.heic");
    expect(e.learnerMessage).not.toContain("prefix/uuid-IMG.heic");
    expect(e.filename).toBe("IMG.heic");
  });
});
