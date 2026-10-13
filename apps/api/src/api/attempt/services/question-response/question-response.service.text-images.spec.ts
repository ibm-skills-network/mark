import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";
import { QuestionResponseService } from "./question-response.service";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type GradeResult = {
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
};

type GradeQuestionNoSave = (
  question: QuestionDto,
  requestDto: CreateQuestionResponseAttemptRequestDto,
  assignmentContext: {
    assignmentInstructions: string;
    questionAnswerContext: [];
  },
  assignmentId: number,
  language: string,
  role: UserRole,
  assignmentAttemptId: number,
  userId?: string,
) => Promise<GradeResult>;

describe("QuestionResponseService images in text answers", () => {
  let service: QuestionResponseService;

  const childLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  const strategy = {
    validateResponse: jest.fn(),
    extractLearnerResponse: jest.fn(),
    gradeResponse: jest.fn(),
  };
  const gradingFactory = { getStrategy: jest.fn(() => strategy) };
  const localization = {
    getLocalizedString: jest.fn(() => "No response was provided."),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    strategy.validateResponse.mockResolvedValue(true);
    strategy.extractLearnerResponse.mockImplementation(
      (dto: CreateQuestionResponseAttemptRequestDto) =>
        Promise.resolve(dto.learnerTextResponse ?? ""),
    );
    strategy.gradeResponse.mockResolvedValue({ totalPoints: 3, feedback: [] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: {} },
        { provide: QuestionService, useValue: {} },
        { provide: LocalizationService, useValue: localization },
        { provide: GradingFactoryService, useValue: gradingFactory },
        {
          provide: GradingRateLimiterService,
          useValue: { schedule: jest.fn() },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { child: jest.fn(() => childLogger) },
        },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
  });

  const grade = (
    type: QuestionType,
    learnerTextResponse: string,
  ): Promise<GradeResult> => {
    const gradeQuestionNoSave = (
      service as unknown as { gradeQuestionNoSave: GradeQuestionNoSave }
    ).gradeQuestionNoSave.bind(service);
    return gradeQuestionNoSave(
      {
        id: 77,
        type,
        question: "Paste the output",
        totalPoints: 3,
      } as QuestionDto,
      {
        id: 77,
        learnerTextResponse,
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto,
      { assignmentInstructions: "", questionAnswerContext: [] },
      12,
      "en",
      UserRole.LEARNER,
      345,
      "learner@example.com",
    );
  };

  it("grades and stores the text of a TEXT answer without the pasted image", async () => {
    const { learnerResponse } = await grade(
      QuestionType.TEXT,
      `<p>My output:</p><p><img src="${PNG}"></p><p>42</p>`,
    );

    const graded = strategy.gradeResponse.mock.calls[0]?.[1] as string;
    expect(graded).toContain("My output:");
    expect(graded).toContain("42");
    expect(graded).not.toMatch(/<img|data:image/i);
    expect(learnerResponse).toBe(graded);
  });

  it("logs a structured warning when images are removed", async () => {
    await grade(
      QuestionType.TEXT,
      `<p>a<img src="${PNG}"><img src="${PNG}"></p>`,
    );

    expect(childLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("image"),
      expect.objectContaining({
        assignmentId: 12,
        assignmentAttemptId: 345,
        questionId: 77,
        removedImageCount: 2,
      }),
    );
  });

  it("treats an image-only TEXT answer as empty instead of grading it", async () => {
    const { learnerResponse, responseDto } = await grade(
      QuestionType.TEXT,
      `<p><img src="${PNG}"></p>`,
    );

    expect(strategy.gradeResponse).not.toHaveBeenCalled();
    expect(learnerResponse).toBe("");
    expect(responseDto.totalPoints).toBe(0);
  });

  it("does not touch answers without images", async () => {
    await grade(QuestionType.TEXT, "<p>plain answer</p>");

    expect(strategy.gradeResponse.mock.calls[0]?.[1]).toBe(
      "<p>plain answer</p>",
    );
    expect(childLogger.warn).not.toHaveBeenCalled();
  });

  it("leaves non-TEXT question types alone", async () => {
    const html = `<p><img src="${PNG}"></p>`;
    await grade(QuestionType.UPLOAD, html);

    expect(strategy.gradeResponse.mock.calls[0]?.[1]).toBe(html);
  });
});
