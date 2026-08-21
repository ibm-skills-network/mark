/* eslint-disable */
/**
 * Service-flow regression test for criteria-based image grading.
 *
 * CONTRACT CHANGE: criteria-based grading used to consume OCR evidence
 * extracted from the learner's images and never looked at the image bytes, so
 * it deliberately skipped the storage fetch and the format preflight. That is
 * what let a screenshot with no extractable text score zero against evidence
 * that was literally the string "[Image content]". Criteria-based grading is a
 * vision call now: it fetches and preflights exactly like the holistic path,
 * and a format the vision model cannot read fails terminally with the
 * learner-facing error instead of silently grading nothing.
 */

import { UnsupportedImageFormatError } from "../../errors/unsupported-image-format.error";

function heicBuffer() {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from("heic", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

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
    assessContent: jest.fn().mockResolvedValue({
      action: "allow",
      flaggedCategories: [],
      severeCategories: [],
    }),
  };
  service.llmResolver = {
    getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4.1-mini"),
  };
  service.promptProcessor = {
    processPromptWithImage: jest.fn().mockResolvedValue(
      JSON.stringify({
        criteria: [
          {
            criterionId: "rubric-1",
            score: 5,
            rationale:
              "The screenshot shows the running login screen with both fields and the submit button.",
          },
        ],
      }),
    ),
  };

  return { service, getObject, mockLogger };
}

function criteriaModel(overrides: Record<string, unknown> = {}) {
  return {
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
          criteria: [
            { description: "clear", points: 5 },
            { description: "unclear", points: 0 },
          ],
        },
      ],
    },
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
    ...overrides,
  };
}

describe("ImageGradingService.gradeImageBasedQuestion - CRITERIA_BASED is a vision call", () => {
  it("fetches the COS-stored image so the model can see it", async () => {
    const { service, getObject } = buildService();

    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 9, g: 9, b: 9 },
      },
    })
      .png()
      .toBuffer();
    getObject.mockResolvedValue({ Body: png });

    const result = await service.gradeImageBasedQuestion(
      criteriaModel({
        learnerImageResponse: [
          {
            filename: "login.png",
            imageData: "InCos",
            imageKey: "assignments/uuid-login.png",
            imageBucket: "submissions",
            imageUrl: "",
            mimeType: "image/png",
          },
        ],
      }),
      1,
    );

    // The bytes are fetched and sent — the old contract asserted the opposite.
    expect(getObject).toHaveBeenCalledTimes(1);
    const [, images] =
      service.promptProcessor.processPromptWithImage.mock.calls[0];
    expect(Array.isArray(images)).toBe(true);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain("data:image/png;base64,");
    expect(result.points).toBe(5);
  });

  it("fails terminally on a COS HEIC instead of grading it blind", async () => {
    const { service, getObject } = buildService();
    getObject.mockResolvedValue({ Body: heicBuffer() });

    await expect(
      service.gradeImageBasedQuestion(criteriaModel(), 1),
    ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(
      service.promptProcessor.processPromptWithImage,
    ).not.toHaveBeenCalled();
  });

  it("propagates a preflight rejection on the non-criteria (vision) path too", async () => {
    const { service, getObject } = buildService();
    getObject.mockResolvedValue({ Body: heicBuffer() });

    await expect(
      service.gradeImageBasedQuestion(
        criteriaModel({
          scoringCriteriaType: "AI_GRADED",
          scoringCriteria: { type: "AI_GRADED", rubrics: [] },
        }),
        1,
      ),
    ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
    expect(getObject).toHaveBeenCalledTimes(1);
  });
});

describe("ImageGradingService.getPrimaryImageForGrading - learner filename, not COS key", () => {
  it("surfaces the submission filename in the rejection, never the storage key", async () => {
    const { service, getObject } = buildService();

    getObject.mockResolvedValue({ Body: heicBuffer() });

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
