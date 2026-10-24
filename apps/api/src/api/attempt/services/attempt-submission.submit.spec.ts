import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType, ResponseType } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { CreateQuestionResponseAttemptResponseDto } from "../../assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import {
  InvalidLearnerFileReferenceException,
  NoGradableQuestionsException,
  UnsupportedResponseTypeException,
} from "../common/utils/learner-file-reference.util";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { AttemptValidationService } from "./attempt-validation.service";
import type { JobScopedCache } from "./grading/job-scoped-cache";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";

type Runner = {
  updateLearnerAttempt: (
    attemptId: number,
    assignmentId: number,
    updateDto: unknown,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: unknown,
  ) => Promise<Record<string, unknown>>;
};

const LEARNER = "learner@example.com";
const ATTEMPT_ID = 555;
const ASSIGNMENT_ID = 2580;

const blank = (id: number) => ({
  id,
  learnerTextResponse: "",
  learnerUrlResponse: "",
  learnerChoices: [],
  learnerAnswerChoice: null,
  learnerFileResponse: [],
  learnerPresentationResponse: null,
});

const liveQuestion = (
  id: number,
  totalPoints: number,
  responseType: ResponseType | null = null,
) => ({
  id,
  totalPoints,
  responseType,
  type: QuestionType.TEXT,
  question: `Live ${id}`,
});

const questionVersion = (
  questionId: number,
  totalPoints: number,
  responseType: ResponseType | null = null,
) => ({
  id: questionId + 10_000,
  assignmentVersionId: 9,
  questionId,
  totalPoints,
  responseType,
  type: QuestionType.TEXT,
  question: `Pinned ${questionId}`,
  maxWords: null,
  maxCharacters: null,
  scoring: null,
  choices: null,
  randomizedChoices: null,
  answer: null,
  gradingContextQuestionIds: [],
  videoPresentationConfig: null,
  liveRecordingConfig: null,
  displayOrder: null,
  authorComment: null,
  createdAt: new Date(),
});

const graded = (
  questionId: number,
  totalPoints: number,
): {
  questionId: number;
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
} => ({
  questionId,
  learnerResponse: "",
  responseDto: {
    id: questionId * 10,
    questionId,
    question: `Question ${questionId}`,
    totalPoints,
    feedback: [{ feedback: `Feedback ${questionId}` }],
    metadata: { internal: true },
    points: totalPoints,
  } as CreateQuestionResponseAttemptResponseDto,
});

describe("AttemptSubmissionService learner submit", () => {
  let service: AttemptSubmissionService;
  const originalBucket = process.env.IBM_COS_LEARNER_BUCKET;

  const mockPrisma = {
    assignmentAttempt: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    assignment: { findUnique: jest.fn() },
    question: { findMany: jest.fn().mockResolvedValue([]) },
    questionVersion: { findMany: jest.fn() },
    questionResponse: { deleteMany: jest.fn() },
  };
  const mockValidationService = { isAttemptExpired: jest.fn() };
  const gradingService = new AttemptGradingService();
  const mockQuestionResponseService = {
    gradeQuestionsForLearner: jest.fn(),
    commitAttemptWithResponses: jest.fn(),
    markGradingComplete: jest.fn(),
  };
  const mockTranslationService = {
    preTranslateQuestions: jest.fn().mockResolvedValue(new Map()),
  };

  const request = { userSession: { userId: LEARNER, role: "Learner" } };

  const submit = (responsesForQuestions: unknown[]) =>
    (service as unknown as Runner).updateLearnerAttempt(
      ATTEMPT_ID,
      ASSIGNMENT_ID,
      { submitted: true, responsesForQuestions, language: "en" },
      "cookie",
      false,
      request,
    );

  const givenAttempt = (overrides: Record<string, unknown> = {}) =>
    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
      id: ATTEMPT_ID,
      userId: LEARNER,
      submitted: false,
      expiresAt: null,
      questionOrder: [101, 202],
      assignmentVersionId: null,
      questionVariants: [],
      ...overrides,
    });

  const givenAssignment = (overrides: Record<string, unknown> = {}) =>
    mockPrisma.assignment.findUnique.mockResolvedValue({
      id: ASSIGNMENT_ID,
      questionOrder: [101, 202],
      questions: [liveQuestion(101, 10), liveQuestion(202, 10)],
      requireAllQuestions: false,
      optionalQuestionIds: [],
      showAssignmentScore: true,
      showSubmissionFeedback: true,
      showQuestions: true,
      showQuestionScore: true,
      showPassFailIndicator: false,
      passingGrade: 50,
      currentVersion: { correctAnswerVisibility: "ON_PASS" },
      ...overrides,
    });

  const gradedIds = (): number[] =>
    (
      mockQuestionResponseService.gradeQuestionsForLearner.mock
        .calls[0][0] as Array<{ id: number }>
    ).map((response) => response.id);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptSubmissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AttemptValidationService, useValue: mockValidationService },
        { provide: AttemptGradingService, useValue: gradingService },
        { provide: AttemptAccessCacheService, useValue: {} },
        {
          provide: QuestionResponseService,
          useValue: mockQuestionResponseService,
        },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: QuestionVariantService, useValue: {} },
        {
          provide: LtiGradeSyncService,
          useValue: { createAndSync: jest.fn() },
        },
        { provide: HttpService, useValue: {} },
      ],
    }).compile();

    service = module.get(AttemptSubmissionService);
    jest.clearAllMocks();
    process.env.IBM_COS_LEARNER_BUCKET = "learner-bucket";
    mockValidationService.isAttemptExpired.mockReturnValue(false);
    mockQuestionResponseService.gradeQuestionsForLearner.mockImplementation(
      async (responses: Array<{ id: number }>) =>
        responses.map((response) =>
          graded(response.id, response.id === 101 ? 10 : 0),
        ),
    );
    mockQuestionResponseService.commitAttemptWithResponses.mockImplementation(
      async (_id: number, _items: unknown, grade: number) => ({
        id: ATTEMPT_ID,
        submitted: true,
        grade,
      }),
    );
    givenAttempt();
    givenAssignment();
  });

  afterAll(() => {
    if (originalBucket === undefined) {
      delete process.env.IBM_COS_LEARNER_BUCKET;
    } else {
      process.env.IBM_COS_LEARNER_BUCKET = originalBucket;
    }
  });

  describe("grade over the served set", () => {
    it("grades a served question left out of the payload as empty and counts its points", async () => {
      const result = await submit([
        { ...blank(101), learnerTextResponse: "answer" },
      ]);

      expect(gradedIds()).toEqual([101, 202]);
      const synthesised = (
        mockQuestionResponseService.gradeQuestionsForLearner.mock
          .calls[0][0] as Array<Record<string, unknown>>
      )[1];
      expect(synthesised).toMatchObject({
        id: 202,
        learnerTextResponse: "",
        learnerChoices: [],
        learnerAnswerChoice: null,
        learnerFileResponse: [],
      });
      // 10 of 20, not 10 of 10.
      const [, , grade] =
        mockQuestionResponseService.commitAttemptWithResponses.mock.calls[0];
      expect(grade).toBe(0.5);
      expect(result).toMatchObject({
        grade: 0.5,
        totalPointsEarned: 10,
        totalPossiblePoints: 20,
      });
    });

    it("still refuses unserved and duplicate ids", async () => {
      await expect(
        submit([blank(101), blank(101), blank(999)]),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockQuestionResponseService.gradeQuestionsForLearner,
      ).not.toHaveBeenCalled();
    });

    it("falls back to the pinned version's questions when no order is stored", async () => {
      givenAttempt({ questionOrder: [], assignmentVersionId: 9 });
      givenAssignment({ questionOrder: [] });
      mockPrisma.questionVersion.findMany.mockResolvedValue([
        questionVersion(101, 4),
        questionVersion(303, 6),
      ]);

      await submit([]);

      expect(gradedIds()).toEqual([101, 303]);
    });
  });

  describe("grade against the pinned version", () => {
    beforeEach(() => {
      givenAttempt({ assignmentVersionId: 9 });
      // The live rows were edited after publishing: different points.
      givenAssignment({
        questions: [liveQuestion(101, 50), liveQuestion(202, 50)],
      });
      mockPrisma.questionVersion.findMany.mockResolvedValue([
        questionVersion(101, 10),
        questionVersion(202, 30),
      ]);
    });

    it("takes the denominator from the pinned version, not the live rows", async () => {
      const result = await submit([blank(101), blank(202)]);

      expect(mockPrisma.questionVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { assignmentVersionId: 9 } }),
      );
      expect(result.totalPossiblePoints).toBe(40);
    });

    it("hands grading the pinned questions through the job cache", async () => {
      await submit([blank(101), blank(202)]);

      const cache = mockQuestionResponseService.gradeQuestionsForLearner.mock
        .calls[0][5] as JobScopedCache;
      expect(cache.pinnedQuestions?.get(101)).toMatchObject({
        id: 101,
        question: "Pinned 101",
        totalPoints: 10,
      });
      const preTranslateCache = mockTranslationService.preTranslateQuestions
        .mock.calls[0][3] as JobScopedCache;
      expect(preTranslateCache).toBe(cache);
    });

    it("uses the live rows when the attempt has no pinned version", async () => {
      givenAttempt({ assignmentVersionId: null });

      const result = await submit([blank(101), blank(202)]);

      expect(mockPrisma.questionVersion.findMany).not.toHaveBeenCalled();
      expect(result.totalPossiblePoints).toBe(100);
      const cache = mockQuestionResponseService.gradeQuestionsForLearner.mock
        .calls[0][5] as JobScopedCache;
      expect(cache.pinnedQuestions).toBeUndefined();
    });
  });

  describe("media response types", () => {
    beforeEach(() => {
      givenAttempt({ questionOrder: [101, 303] });
      givenAssignment({
        questionOrder: [101, 303],
        questions: [
          liveQuestion(101, 10),
          liveQuestion(303, 25, ResponseType.PRESENTATION),
        ],
        requireAllQuestions: true,
      });
    });

    it("leaves them out of grading, the denominator and the required check", async () => {
      const result = await submit([
        { ...blank(101), learnerTextResponse: "answer" },
        blank(303),
      ]);

      expect(gradedIds()).toEqual([101]);
      expect(result.totalPossiblePoints).toBe(10);
      expect(result.grade).toBe(1);
    });

    it.each([
      ResponseType.PRESENTATION,
      ResponseType.VIDEO,
      ResponseType.AUDIO,
      ResponseType.LIVE_RECORDING,
    ])("refuses an answer to a %s question", async (responseType) => {
      givenAssignment({
        questionOrder: [101, 303],
        questions: [liveQuestion(101, 10), liveQuestion(303, 25, responseType)],
      });
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          "warn",
        )
        .mockImplementation(() => undefined);

      const error: unknown = await submit([
        blank(101),
        { ...blank(303), learnerTextResponse: "a transcript" },
      ]).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnsupportedResponseTypeException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        code: "UNSUPPORTED_RESPONSE_TYPE",
        message: "This question type is no longer supported.",
        error: "Bad Request",
      });
      expect(warn).toHaveBeenCalledWith(
        "submit.rejected",
        expect.objectContaining({
          assignment_id: ASSIGNMENT_ID,
          attempt_id: ATTEMPT_ID,
          user_id: LEARNER,
          denial_reason: "unsupported_response_type",
        }),
      );
      expect(
        mockQuestionResponseService.gradeQuestionsForLearner,
      ).not.toHaveBeenCalled();
    });

    it("refuses an attempt whose served questions are all media before anything is graded, written or sent", async () => {
      givenAttempt({ questionOrder: [303, 404] });
      givenAssignment({
        questionOrder: [303, 404],
        questions: [
          liveQuestion(303, 25, ResponseType.PRESENTATION),
          liveQuestion(404, 5, ResponseType.VIDEO),
        ],
      });
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          "warn",
        )
        .mockImplementation(() => undefined);

      const error: unknown = await submit([blank(303), blank(404)]).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(NoGradableQuestionsException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        statusCode: 422,
        code: "NO_GRADABLE_QUESTIONS",
        message: "This assignment has no questions that can be graded.",
        error: "Unprocessable Entity",
      });
      expect(warn).toHaveBeenCalledWith(
        "submit.rejected",
        expect.objectContaining({ denial_reason: "no_gradable_questions" }),
      );
      expect(
        mockQuestionResponseService.gradeQuestionsForLearner,
      ).not.toHaveBeenCalled();
      expect(
        mockQuestionResponseService.commitAttemptWithResponses,
      ).not.toHaveBeenCalled();
    });

    it("gives the queued-submit pre-check the same 422", async () => {
      givenAttempt({ questionOrder: [303] });
      givenAssignment({
        questionOrder: [303],
        questions: [liveQuestion(303, 25, ResponseType.AUDIO)],
      });

      await expect(
        service.assertSubmitPayloadAcceptable(
          ATTEMPT_ID,
          ASSIGNMENT_ID,
          LEARNER,
          {
            submitted: true,
            responsesForQuestions: [],
          },
        ),
      ).rejects.toBeInstanceOf(NoGradableQuestionsException);
    });

    it("judges the response type by the pinned version", async () => {
      givenAttempt({ questionOrder: [101, 303], assignmentVersionId: 9 });
      // Live row was switched to a text question after publishing; the
      // learner was served the pinned media question.
      givenAssignment({
        questionOrder: [101, 303],
        questions: [liveQuestion(101, 10), liveQuestion(303, 25)],
      });
      mockPrisma.questionVersion.findMany.mockResolvedValue([
        questionVersion(101, 10),
        questionVersion(303, 25, ResponseType.LIVE_RECORDING),
      ]);

      await expect(
        submit([blank(101), { ...blank(303), learnerTextResponse: "x" }]),
      ).rejects.toBeInstanceOf(UnsupportedResponseTypeException);
    });
  });

  describe("required questions", () => {
    it("requires every served gradable question not marked optional", async () => {
      givenAssignment({ requireAllQuestions: true, optionalQuestionIds: [] });

      await expect(
        submit([{ ...blank(101), learnerTextResponse: "answer" }]),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("lets an optional question go unanswered", async () => {
      givenAssignment({
        requireAllQuestions: true,
        optionalQuestionIds: [202],
      });

      await expect(
        submit([{ ...blank(101), learnerTextResponse: "answer" }]),
      ).resolves.toBeDefined();
    });
  });

  describe("uploaded files", () => {
    const file = (key: string, bucket = "learner-bucket") => ({
      filename: "report.pdf",
      key,
      bucket,
      content: "InCos",
    });

    it("accepts the learner's own upload for that question", async () => {
      await expect(
        submit([
          {
            ...blank(101),
            learnerFileResponse: [
              file(`${ASSIGNMENT_ID}/${LEARNER}/101/abc-report.pdf`),
            ],
          },
        ]),
      ).resolves.toBeDefined();
    });

    it.each([
      ["another learner", `${ASSIGNMENT_ID}/other@example.com/101/a.pdf`],
      ["another question", `${ASSIGNMENT_ID}/${LEARNER}/202/a.pdf`],
      ["another assignment", `1/${LEARNER}/101/a.pdf`],
    ])("refuses a key belonging to %s", async (_label, key) => {
      await expect(
        submit([{ ...blank(101), learnerFileResponse: [file(key)] }]),
      ).rejects.toBeInstanceOf(InvalidLearnerFileReferenceException);
      expect(
        mockQuestionResponseService.gradeQuestionsForLearner,
      ).not.toHaveBeenCalled();
    });

    it("refuses a bucket that is not a learner bucket", async () => {
      await expect(
        submit([
          {
            ...blank(101),
            learnerFileResponse: [
              file(`${ASSIGNMENT_ID}/${LEARNER}/101/a.pdf`, "author-bucket"),
            ],
          },
        ]),
      ).rejects.toBeInstanceOf(InvalidLearnerFileReferenceException);
    });
  });

  describe("submit result", () => {
    it("carries only the learner-facing fields", async () => {
      const result = await submit([blank(101), blank(202)]);

      expect(result).toEqual({
        id: ATTEMPT_ID,
        submitted: true,
        grade: 0.5,
        totalPointsEarned: 10,
        totalPossiblePoints: 20,
        passed: null,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestions: true,
        showQuestionScore: true,
        showPassFailIndicator: false,
        correctAnswerVisibility: "ON_PASS",
        feedbacksForQuestions: [
          {
            id: 1010,
            questionId: 101,
            totalPoints: 10,
            feedback: [{ feedback: "Feedback 101" }],
          },
          {
            id: 2020,
            questionId: 202,
            totalPoints: 0,
            feedback: [{ feedback: "Feedback 202" }],
          },
        ],
      });
    });

    it("nulls what the assignment hides", async () => {
      givenAssignment({
        showAssignmentScore: false,
        showQuestionScore: false,
        showSubmissionFeedback: false,
        showPassFailIndicator: true,
        passingGrade: 40,
      });

      const result = await submit([blank(101), blank(202)]);

      expect(result).toMatchObject({
        grade: null,
        totalPointsEarned: null,
        totalPossiblePoints: null,
        // Computed from the real grade even though the score is hidden.
        passed: true,
      });
      expect(result.feedbacksForQuestions).toEqual([
        { id: 1010, questionId: 101, totalPoints: null, feedback: null },
        { id: 2020, questionId: 202, totalPoints: null, feedback: null },
      ]);
    });
  });

  describe("submit result with questions hidden", () => {
    it("sends no per-question entries", async () => {
      givenAssignment({ showQuestions: false });

      const result = await submit([blank(101), blank(202)]);

      expect(result.showQuestions).toBe(false);
      expect(result.feedbacksForQuestions).toEqual([]);
    });
  });

  describe("multiple-correct feedback", () => {
    const multipleCorrect = (perfectScore: boolean) => ({
      questionId: 101,
      learnerResponse: "",
      responseDto: {
        id: 1010,
        questionId: 101,
        question: "Pick all primes",
        totalPoints: perfectScore ? 10 : 0,
        feedback: [
          { choice: "4", feedback: "**Incorrect selection:** 4 (-0 points)." },
        ],
        metadata: { perfectScore, correctChoices: ["2", "3"] },
        points: perfectScore ? 10 : 0,
      } as CreateQuestionResponseAttemptResponseDto,
    });

    beforeEach(() => {
      mockQuestionResponseService.gradeQuestionsForLearner.mockResolvedValue([
        multipleCorrect(false),
        graded(202, 10),
      ]);
    });

    const feedbackText = (result: Record<string, unknown>): string =>
      JSON.stringify(
        (result.feedbacksForQuestions as Array<{ feedback: unknown }>)[0]
          .feedback,
      );

    it("names the correct options when the answer key is revealed", async () => {
      givenAssignment({
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await submit([blank(101), blank(202)]);

      expect(feedbackText(result)).toContain(
        "The correct option(s) were: **2, 3**.",
      );
    });

    it("keeps them out while the answer key is hidden", async () => {
      givenAssignment({ currentVersion: { correctAnswerVisibility: "NEVER" } });

      const result = await submit([blank(101), blank(202)]);

      expect(feedbackText(result)).not.toContain("correct option");
      expect(feedbackText(result)).not.toContain("2, 3");
    });

    it("follows ON_PASS from the submit's own grade", async () => {
      // 10 of 20 points against a 60% pass mark: not passed, key hidden.
      givenAssignment({ passingGrade: 60 });

      const result = await submit([blank(101), blank(202)]);

      expect(feedbackText(result)).not.toContain("2, 3");
    });
  });

  describe("true/false feedback", () => {
    beforeEach(() => {
      mockQuestionResponseService.gradeQuestionsForLearner.mockResolvedValue([
        {
          questionId: 101,
          learnerResponse: false,
          responseDto: {
            id: 1010,
            questionId: 101,
            question: "The sky is blue",
            totalPoints: 0,
            feedback: [{ choice: false, feedback: "Incorrect." }],
            metadata: { isCorrect: false, correctAnswer: true },
            points: 0,
          } as CreateQuestionResponseAttemptResponseDto,
        },
        graded(202, 10),
      ]);
    });

    const firstFeedback = (result: Record<string, unknown>) =>
      (result.feedbacksForQuestions as Array<{ feedback: unknown }>)[0]
        .feedback;

    it("names the correct answer when the key is revealed", async () => {
      givenAssignment({
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await submit([blank(101), blank(202)]);

      expect(firstFeedback(result)).toEqual([
        { choice: false, feedback: "Incorrect. The correct answer is True." },
      ]);
    });

    it("keeps it out while the key is hidden", async () => {
      givenAssignment({ currentVersion: { correctAnswerVisibility: "NEVER" } });

      const result = await submit([blank(101), blank(202)]);

      expect(firstFeedback(result)).toEqual([
        { choice: false, feedback: "Incorrect." },
      ]);
    });
  });

  describe("assertSubmitPayloadAcceptable", () => {
    it("404s an attempt that does not exist", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(null);

      await expect(
        service.assertSubmitPayloadAcceptable(
          ATTEMPT_ID,
          ASSIGNMENT_ID,
          LEARNER,
          {
            submitted: true,
            responsesForQuestions: [],
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses before grading what grading would refuse", async () => {
      await expect(
        service.assertSubmitPayloadAcceptable(
          ATTEMPT_ID,
          ASSIGNMENT_ID,
          LEARNER,
          {
            submitted: true,
            responsesForQuestions: [
              {
                ...blank(101),
                learnerFileResponse: [
                  {
                    filename: "a.pdf",
                    key: `${ASSIGNMENT_ID}/other@example.com/101/a.pdf`,
                    bucket: "learner-bucket",
                  },
                ],
                language: "en",
              },
            ],
          },
        ),
      ).rejects.toBeInstanceOf(InvalidLearnerFileReferenceException);
      expect(
        mockQuestionResponseService.gradeQuestionsForLearner,
      ).not.toHaveBeenCalled();
    });

    it("accepts a payload with answered and unanswered served questions", async () => {
      await expect(
        service.assertSubmitPayloadAcceptable(
          ATTEMPT_ID,
          ASSIGNMENT_ID,
          LEARNER,
          {
            submitted: true,
            responsesForQuestions: [{ ...blank(101), language: "en" }],
          },
        ),
      ).resolves.toBeUndefined();
    });
  });
});
