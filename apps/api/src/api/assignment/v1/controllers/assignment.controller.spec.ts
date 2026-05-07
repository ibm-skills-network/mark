import { BadRequestException } from "@nestjs/common";
import { QuestionGenerationPayload } from "../../dto/post.assignment.request.dto";
import { AssignmentTypeEnum } from "../../../llm/features/question-generation/services/question-generation.service";
import { AssignmentControllerV1 } from "./assignment.controller";

describe("AssignmentControllerV1", () => {
  const logger = {
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const assignmentService = {
    createJob: jest.fn(),
    handleFileContents: jest.fn(),
  };

  let controller: AssignmentControllerV1;

  const request = {
    userSession: {
      userId: "author-123",
    },
  } as any;

  const createPayload = (
    overrides: Partial<QuestionGenerationPayload> = {},
  ): QuestionGenerationPayload => ({
    assignmentId: 1,
    assignmentType: AssignmentTypeEnum.PRACTICE,
    questionsToGenerate: {
      multipleChoice: 0,
      multipleSelect: 0,
      textResponse: 0,
      trueFalse: 0,
      url: 0,
      upload: 0,
      linkFile: 0,
    },
    fileContents: [
      {
        filename: "notes.txt",
        content: "These are the learning notes.",
      },
    ],
    learningObjectives: "Understand the product positioning.",
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    assignmentService.createJob.mockResolvedValue({ id: 42 });
    assignmentService.handleFileContents.mockResolvedValue(undefined);

    controller = new AssignmentControllerV1(
      logger as any,
      assignmentService as any,
      {} as any,
      {} as any,
    );
  });

  it("accepts subtype-only generation requests", async () => {
    const payload = createPayload({
      questionsToGenerate: {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 2,
          quantitative: 0,
          long: 0,
          scenario: 1,
        },
      },
    });

    await expect(
      controller.uploadFileContents(1, payload, request),
    ).resolves.toEqual({
      message: "File processing started",
      jobId: 42,
    });

    expect(assignmentService.createJob).toHaveBeenCalledWith(
      payload.assignmentId,
      request.userSession.userId,
    );
    expect(assignmentService.handleFileContents).toHaveBeenCalledWith(
      payload.assignmentId,
      42,
      payload.assignmentType,
      payload.questionsToGenerate,
      payload.fileContents,
      payload.learningObjectives,
    );
  });

  it("rejects subtype payloads when every subtype count is zero", async () => {
    const payload = createPayload({
      questionsToGenerate: {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 0,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
    });

    await expect(
      controller.uploadFileContents(1, payload, request),
    ).rejects.toThrow(BadRequestException);

    expect(assignmentService.createJob).not.toHaveBeenCalled();
    expect(assignmentService.handleFileContents).not.toHaveBeenCalled();
  });
});
