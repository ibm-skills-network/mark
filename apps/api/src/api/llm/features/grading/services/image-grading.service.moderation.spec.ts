import sharp from "sharp";
import { ImageGradingService } from "./image-grading.service";

function mockLogger() {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function buildService(assessContent: jest.Mock) {
  const service: any = Object.create(ImageGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = {
    processPromptWithImage: jest.fn().mockResolvedValue("{}"),
  };
  service.llmResolver = {
    getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4.1-mini"),
  };
  return { service, mockLogger: service.logger };
}

function gradeModel() {
  return {
    question: "Draw a diagram",
    imageData: "data:image/png;base64,AAAA",
    learnerResponse: "my diagram",
    totalPoints: 5,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    learnerImageResponse: [],
  };
}

describe("ImageGradingService moderation verdicts", () => {
  it("passes the image urls to moderation", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service } = buildService(assessContent);

    await (service as any).gradeImageBasedQuestion(gradeModel(), 1736);

    expect(assessContent).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["data:image/png;base64,AAAA"]),
    );
  });

  it("returns a 0-point result without invoking the vision model on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service, mockLogger } = buildService(assessContent);

    const result = await (service as any).gradeImageBasedQuestion(
      gradeModel(),
      1736,
    );

    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(
      service.promptProcessor.processPromptWithImage,
    ).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.blocked_severe",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });

  it("moderates a COS-stored image the up-front gate could not see, and never calls the vision model when it is severe", async () => {
    // The up-front gate only accepts http/data: URL shapes. A COS-stored
    // image arrives as the "InCos" sentinel, so imageUrlsForModeration is
    // empty and the first assessContent call sees no images at all.
    const assessContent = jest
      .fn()
      .mockResolvedValueOnce({
        action: "allow",
        flaggedCategories: [],
        severeCategories: [],
      })
      .mockResolvedValueOnce({
        action: "block_severe",
        flaggedCategories: ["sexual/minors"],
        severeCategories: ["sexual/minors"],
      });
    const { service, mockLogger } = buildService(assessContent);

    const smallPng = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();
    const getObject = jest.fn().mockResolvedValue({ Body: smallPng });
    service.s3Service = { getObject };

    const model = {
      ...gradeModel(),
      imageData: "",
      learnerImageResponse: [
        {
          filename: "photo.png",
          imageData: "InCos",
          imageBucket: "submissions",
          imageKey: "assignments/uuid-photo.png",
          imageUrl: "",
          mimeType: "image/png",
        },
      ],
    };

    const result = await (service as any).gradeImageBasedQuestion(model, 1736);

    expect(assessContent).toHaveBeenCalledTimes(2);
    expect(assessContent).toHaveBeenNthCalledWith(1, expect.any(String), []);
    expect(assessContent).toHaveBeenNthCalledWith(2, "", [
      expect.stringContaining("data:image/png;base64,"),
    ]);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(
      service.promptProcessor.processPromptWithImage,
    ).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.blocked_severe",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });

  it("moderates a primary image submitted as raw base64 (no data: prefix) that the up-front gate could not see, and never calls the vision model when it is severe", async () => {
    // The up-front gate only accepts http/data: shaped strings. A learner
    // (or a hostile client bypassing normal upload plumbing) can submit the
    // primary image as bare base64 with no "data:" prefix — that string is
    // truthy and not the "InCos" storage sentinel, so it is treated as an
    // inline image, yet it also fails the gate's startsWith("http"/"data:")
    // filter and is excluded from imageUrlsForModeration. Without the fix,
    // this image would reach the vision model with no moderation at all.
    const assessContent = jest
      .fn()
      .mockResolvedValueOnce({
        action: "allow",
        flaggedCategories: [],
        severeCategories: [],
      })
      .mockResolvedValueOnce({
        action: "block_severe",
        flaggedCategories: ["sexual/minors"],
        severeCategories: ["sexual/minors"],
      });
    const { service, mockLogger } = buildService(assessContent);

    const smallPng = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 4, g: 5, b: 6 },
      },
    })
      .png()
      .toBuffer();
    const rawBase64 = smallPng.toString("base64");

    const model = {
      ...gradeModel(),
      imageData: rawBase64,
      learnerImageResponse: [],
    };

    const result = await (service as any).gradeImageBasedQuestion(model, 1736);

    expect(assessContent).toHaveBeenCalledTimes(2);
    expect(assessContent).toHaveBeenNthCalledWith(1, expect.any(String), []);
    expect(assessContent).toHaveBeenNthCalledWith(2, "", [
      expect.stringContaining("data:image/png;base64,"),
    ]);
    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(
      service.promptProcessor.processPromptWithImage,
    ).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.blocked_severe",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });
});
