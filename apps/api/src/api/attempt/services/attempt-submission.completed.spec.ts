import { HttpService } from "@nestjs/axios";
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";

type Visibility = "NEVER" | "ALWAYS" | "ON_PASS";

interface AssignmentRow {
  id: number;
  questionOrder: number[];
  displayOrder: null;
  passingGrade: number | null;
  showAssignmentScore: boolean;
  showSubmissionFeedback: boolean;
  showQuestionScore: boolean;
  showQuestions: boolean;
  showPassFailIndicator: boolean;
  updatedAt: Date;
  currentVersion: { correctAnswerVisibility: Visibility } | null;
}

interface ResponseRow {
  id: number;
  assignmentAttemptId: number;
  questionId: number;
  learnerResponse: string;
  points: number;
  feedback: unknown;
  metadata: unknown;
  gradedAt: Date | null;
}

const LEARNER: UserSession = {
  userId: "learner@example.com",
  role: UserRole.LEARNER,
  assignmentId: 99,
  groupId: "group-1",
};

const AUTHOR: UserSession = {
  userId: "author@example.com",
  role: UserRole.AUTHOR,
  assignmentId: 99,
  groupId: "group-1",
};

const CREATED_AT = new Date("2026-10-01T10:00:00.000Z");
const SUBMITTED_AT = new Date("2026-10-01T10:30:00.000Z");

const choiceQuestion = {
  id: 101,
  question: "Pick the capital of France",
  type: "SINGLE_CORRECT",
  assignmentId: 99,
  totalPoints: 5,
  choices: [
    { id: 0, choice: "Paris", isCorrect: true, points: 5, feedback: "Right" },
    { id: 1, choice: "Lyon", isCorrect: false, points: 0 },
  ],
  scoring: null,
  answer: "Paris",
  gradingContextQuestionIds: [],
  responseType: null,
  isDeleted: false,
  randomizedChoices: "false",
  videoPresentationConfig: null,
  liveRecordingConfig: null,
};

const textQuestion = {
  id: 202,
  question: "Explain photosynthesis",
  type: "TEXT",
  assignmentId: 99,
  totalPoints: 5,
  choices: [],
  scoring: {
    type: "CRITERIA_BASED",
    showRubricsToLearner: false,
    rubrics: [{ rubricQuestion: "hidden rubric", criteria: [] }],
  },
  answer: "model answer text",
  gradingContextQuestionIds: [],
  responseType: "ESSAY",
  isDeleted: false,
  randomizedChoices: "false",
  videoPresentationConfig: null,
  liveRecordingConfig: null,
};

const response = (overrides: Partial<ResponseRow>): ResponseRow => ({
  id: 1,
  assignmentAttemptId: 71,
  questionId: 101,
  learnerResponse: JSON.stringify(["Paris"]),
  points: 5,
  feedback: [{ feedback: "Well done" }],
  metadata: null,
  gradedAt: SUBMITTED_AT,
  ...overrides,
});

const baseAttempt = () => ({
  id: 71,
  assignmentId: 99,
  assignmentVersionId: 12,
  userId: LEARNER.userId,
  submitted: true,
  grade: 0.5,
  createdAt: CREATED_AT,
  expiresAt: SUBMITTED_AT,
  questionOrder: [101, 202],
  comments: null,
  preferredLanguage: "en",
  questionResponses: [
    response({ id: 1, questionId: 101 }),
    response({
      id: 2,
      questionId: 202,
      learnerResponse: JSON.stringify("Plants turn light into sugar"),
      points: 0,
      feedback: [{ feedback: "Missing chlorophyll" }],
    }),
  ],
  questionVariants: [],
  assignmentVersion: {
    id: 12,
    allotedTimeMinutes: 45,
    createdBy: "author-email@example.com",
    questionVersions: [{ id: 1001, questionId: 101, answer: "Paris" }],
  },
});

const baseAssignment = (
  overrides: Partial<AssignmentRow> = {},
): AssignmentRow => ({
  id: 99,
  questionOrder: [101, 202],
  displayOrder: null,
  passingGrade: 50,
  showAssignmentScore: true,
  showSubmissionFeedback: true,
  showQuestionScore: true,
  showQuestions: true,
  showPassFailIndicator: false,
  updatedAt: new Date("2026-04-26T00:00:00.000Z"),
  currentVersion: { correctAnswerVisibility: "ALWAYS" },
  ...overrides,
});

describe("AttemptSubmissionService.getLearnerAssignmentAttempt (completed attempt)", () => {
  let service: AttemptSubmissionService;

  const mockPrisma = {
    assignmentAttempt: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    assignment: { findUnique: jest.fn() },
    question: { findMany: jest.fn() },
    translation: { findMany: jest.fn() },
  };
  const mockAttemptAccessCacheService = {
    getQuestionDtosForAttemptAccess: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptSubmissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AttemptValidationService, useValue: {} },
        { provide: AttemptGradingService, useValue: {} },
        {
          provide: AttemptAccessCacheService,
          useValue: mockAttemptAccessCacheService,
        },
        { provide: QuestionResponseService, useValue: {} },
        { provide: TranslationService, useValue: {} },
        { provide: QuestionVariantService, useValue: {} },
        { provide: LtiGradeSyncService, useValue: {} },
        { provide: HttpService, useValue: {} },
      ],
    }).compile();
    service = module.get(AttemptSubmissionService);

    jest.clearAllMocks();
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue(baseAttempt());
    mockPrisma.assignment.findUnique.mockResolvedValue(baseAssignment());
    mockPrisma.question.findMany.mockResolvedValue([]);
    mockPrisma.translation.findMany.mockResolvedValue([]);
    mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
      [choiceQuestion, textQuestion],
    );
  });

  const read = (session: UserSession = LEARNER, assignmentId = 99) =>
    service.getLearnerAssignmentAttempt(71, assignmentId, session);

  describe("access", () => {
    it("reads only a submitted attempt of the route assignment owned by the learner", async () => {
      await read();

      expect(mockPrisma.assignmentAttempt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 71,
            assignmentId: 99,
            submitted: true,
            userId: LEARNER.userId,
          },
        }),
      );
    });

    it("404s an attempt that is still open, with the not-owned body", async () => {
      // The `submitted: true` filter is what keeps an open attempt out.
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue(null);

      const error = await read().catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        statusCode: 404,
        message: "Attempt not found or not owned by the user",
        error: "Not Found",
      });
    });

    it("scopes an author to the route assignment, so another assignment's attempt is 404", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue(null);

      await expect(read(AUTHOR, 98)).rejects.toThrow(
        "Attempt not found or not owned by the user",
      );
      expect(mockPrisma.assignmentAttempt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 71, assignmentId: 98, submitted: true },
        }),
      );
    });

    it("refuses a learner session without a user id before querying", async () => {
      await expect(
        read({ ...LEARNER, userId: "" } as UserSession),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.assignmentAttempt.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("shape", () => {
    it("returns exactly the learner fields and nothing from the answer key", async () => {
      const result = await read();
      const serialized = JSON.stringify(result);

      expect(Object.keys(result).sort()).toEqual(
        [
          "id",
          "assignmentId",
          "submitted",
          "createdAt",
          "expiresAt",
          "preferredLanguage",
          "comments",
          "serverNow",
          "grade",
          "totalPointsEarned",
          "totalPossiblePoints",
          "passed",
          "passingGrade",
          "showAssignmentScore",
          "showSubmissionFeedback",
          "showQuestions",
          "showQuestionScore",
          "showPassFailIndicator",
          "correctAnswerVisibility",
          "questions",
        ].sort(),
      );
      expect(result).toMatchObject({
        id: 71,
        assignmentId: 99,
        submitted: true,
        createdAt: CREATED_AT,
        expiresAt: SUBMITTED_AT,
        preferredLanguage: "en",
        comments: null,
        grade: 0.5,
        totalPointsEarned: 5,
        totalPossiblePoints: 10,
        passed: null,
        passingGrade: 50,
        correctAnswerVisibility: "ALWAYS",
      });
      expect(Object.keys(result.questions[0]).sort()).toEqual(
        [
          "id",
          "question",
          "type",
          "responseType",
          "totalPoints",
          "choices",
          "scoring",
          "response",
        ].sort(),
      );
      expect(serialized).not.toContain("author-email@example.com");
      expect(serialized).not.toContain(LEARNER.userId);
      expect(serialized).not.toContain("model answer text");
      expect(serialized).not.toContain("hidden rubric");
      for (const choice of result.questions[0].choices ?? []) {
        expect(choice).not.toHaveProperty("points");
      }
      expect(serialized).not.toContain("questionVariants");
      expect(serialized).not.toContain("questionResponses");
    });

    it("attaches the newest response per question with its parsed learner response", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionResponses: [
          response({ id: 1, questionId: 101, points: 0 }),
          response({ id: 3, questionId: 101, points: 5 }),
          response({
            id: 2,
            questionId: 202,
            learnerResponse: "plain text from an older row",
            points: 2,
            feedback: JSON.stringify([{ feedback: "Stored as text" }]),
          }),
        ],
      });

      const result = await read();

      expect(result.questions.map((q) => q.response)).toEqual([
        {
          learnerResponse: ["Paris"],
          points: 5,
          feedback: [{ feedback: "Well done" }],
        },
        {
          learnerResponse: "plain text from an older row",
          points: 2,
          feedback: [{ feedback: "Stored as text" }],
        },
      ]);
    });

    it("gives a served question without a response a null response", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionResponses: [response({ id: 1, questionId: 101 })],
      });

      const result = await read();

      expect(result.questions[1]).toMatchObject({ id: 202, response: null });
    });

    it("keeps the served order and the question's own fields", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionOrder: [202, 101],
      });

      const result = await read();

      expect(result.questions.map((q) => q.id)).toEqual([202, 101]);
      expect(result.questions[0]).toMatchObject({
        question: "Explain photosynthesis",
        type: "TEXT",
        responseType: "ESSAY",
        totalPoints: 5,
        choices: null,
        scoring: null,
      });
    });

    it("shows scoring only when the author shows rubrics to learners", async () => {
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [
          choiceQuestion,
          {
            ...textQuestion,
            scoring: {
              type: "CRITERIA_BASED",
              showRubricsToLearner: true,
              rubrics: [{ rubricQuestion: "Visible rubric", criteria: [] }],
            },
          },
        ],
      );

      const result = await read();

      expect(result.questions[1].scoring).toEqual({
        type: "CRITERIA_BASED",
        showRubricsToLearner: true,
        rubrics: [{ rubricQuestion: "Visible rubric", criteria: [] }],
      });
    });

    it("shows the question's choices when the attempt froze no choice order", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionVariants: [
          {
            questionId: 101,
            questionVariantId: null,
            questionVariant: null,
            randomizedChoices: null,
          },
        ],
      });

      const result = await read();

      expect(result.questions[0].choices?.map((c) => c.choice)).toEqual([
        "Paris",
        "Lyon",
      ]);
    });

    it("serves the stored translation for the attempt's preferred language", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        preferredLanguage: "fr",
      });
      mockPrisma.translation.findMany.mockImplementation(
        ({ where }: { where: { questionId: number } }) =>
          Promise.resolve(
            where.questionId === 101
              ? [
                  {
                    questionId: 101,
                    variantId: null,
                    languageCode: "fr",
                    translatedText: "Choisissez la capitale",
                    translatedChoices: [
                      { id: 0, choice: "Paris (fr)", isCorrect: true },
                      { id: 1, choice: "Lyon (fr)", isCorrect: false },
                    ],
                  },
                ]
              : [],
          ),
      );

      const result = await read();

      expect(result.questions[0].question).toBe("Choisissez la capitale");
      expect(result.questions[0].choices).toEqual([
        { id: 0, choice: "Paris (fr)", isCorrect: true, feedback: null },
        { id: 1, choice: "Lyon (fr)", isCorrect: false, feedback: null },
      ]);
      expect(result.questions[1].question).toBe("Explain photosynthesis");
    });

    it("shows choices in the attempt's frozen order", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionVariants: [
          {
            questionId: 101,
            questionVariantId: null,
            questionVariant: null,
            randomizedChoices: [
              { id: 1, choice: "Lyon", isCorrect: false, points: 0 },
              {
                id: 0,
                choice: "Paris",
                isCorrect: true,
                points: 5,
                feedback: "Right",
              },
            ],
          },
        ],
      });

      const result = await read();

      expect(result.questions[0].choices?.map((c) => c.choice)).toEqual([
        "Lyon",
        "Paris",
      ]);
    });
  });

  describe("correct-answer visibility", () => {
    const withVisibility = (
      visibility: Visibility,
      overrides: Partial<AssignmentRow> = {},
    ) =>
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({
          currentVersion: { correctAnswerVisibility: visibility },
          ...overrides,
        }),
      );

    it("ALWAYS reveals isCorrect and feedback, with null feedback where the author gave none", async () => {
      withVisibility("ALWAYS");

      const result = await read();

      expect(result.questions[0].choices).toEqual([
        { id: 0, choice: "Paris", isCorrect: true, feedback: "Right" },
        { id: 1, choice: "Lyon", isCorrect: false, feedback: null },
      ]);
    });

    it("NEVER sends only id and choice", async () => {
      withVisibility("NEVER");

      const result = await read();

      expect(result.correctAnswerVisibility).toBe("NEVER");
      expect(result.questions[0].choices).toEqual([
        { id: 0, choice: "Paris" },
        { id: 1, choice: "Lyon" },
      ]);
    });

    it("defaults to NEVER when the assignment has no current version", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ currentVersion: null }),
      );

      const result = await read();

      expect(result.correctAnswerVisibility).toBe("NEVER");
      expect(result.questions[0].choices?.[0]).toEqual({
        id: 0,
        choice: "Paris",
      });
    });

    it("ON_PASS reveals the key to a learner who passed", async () => {
      withVisibility("ON_PASS");

      const result = await read();

      expect(result.questions[0].choices?.[0]).toEqual({
        id: 0,
        choice: "Paris",
        isCorrect: true,
        feedback: "Right",
      });
    });

    it("ON_PASS hides the key from a learner who failed", async () => {
      withVisibility("ON_PASS", { passingGrade: 60 });

      const result = await read();

      expect(result.questions[0].choices?.[0]).toEqual({
        id: 0,
        choice: "Paris",
      });
    });

    it("ON_PASS decides on the clamped grade, not an inflated stored one", async () => {
      withVisibility("ON_PASS", { passingGrade: 60 });
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        grade: 1,
        questionResponses: [
          response({ id: 1, questionId: 101, points: 9 }),
          response({ id: 2, questionId: 202, points: 0 }),
        ],
      });

      const result = await read();

      expect(result.grade).toBe(0.5);
      expect(result.questions[0].choices?.[0]).not.toHaveProperty("isCorrect");
    });

    it("ON_PASS still reveals when the score itself is hidden", async () => {
      withVisibility("ON_PASS", { showAssignmentScore: false });

      const result = await read();

      expect(result.grade).toBeNull();
      expect(result.questions[0].choices?.[0]).toHaveProperty(
        "isCorrect",
        true,
      );
    });
  });

  describe("assignment visibility flags", () => {
    it("showAssignmentScore=false nulls the grade and both totals", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showAssignmentScore: false }),
      );

      const result = await read();

      expect(result.showAssignmentScore).toBe(false);
      expect(result.grade).toBeNull();
      expect(result.totalPointsEarned).toBeNull();
      expect(result.totalPossiblePoints).toBeNull();
    });

    it("showPassFailIndicator=true tells the learner the verdict even with the score hidden", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({
          showAssignmentScore: false,
          showPassFailIndicator: true,
          passingGrade: 60,
        }),
      );

      const result = await read();

      expect(result.showPassFailIndicator).toBe(true);
      expect(result.passed).toBe(false);
    });

    it("showPassFailIndicator=true with a passing grade says passed", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showPassFailIndicator: true }),
      );

      expect((await read()).passed).toBe(true);
    });

    it("passed is null when the attempt has no grade", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showPassFailIndicator: true }),
      );
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        grade: null,
      });

      expect((await read()).passed).toBeNull();
    });

    it("showPassFailIndicator=false sends passed as null", async () => {
      expect((await read()).passed).toBeNull();
    });

    it("showQuestionScore=false nulls each response's points", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showQuestionScore: false }),
      );

      const result = await read();

      expect(result.showQuestionScore).toBe(false);
      expect(result.questions.map((q) => q.response?.points)).toEqual([
        null,
        null,
      ]);
      expect(result.questions[0].response?.feedback).toEqual([
        { feedback: "Well done" },
      ]);
    });

    it("showSubmissionFeedback=false nulls each response's feedback", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showSubmissionFeedback: false }),
      );

      const result = await read();

      expect(result.showSubmissionFeedback).toBe(false);
      expect(result.questions.map((q) => q.response?.feedback)).toEqual([
        null,
        null,
      ]);
      expect(result.questions[0].response?.points).toBe(5);
    });

    it("showQuestions=false sends no questions but keeps the totals", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ showQuestions: false }),
      );

      const result = await read();

      expect(result.showQuestions).toBe(false);
      expect(result.questions).toEqual([]);
      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(5);
      expect(JSON.stringify(result)).not.toContain("Well done");
    });
  });

  describe("score totals", () => {
    it("scopes totalPossiblePoints to the questions served this attempt, not the whole bank", async () => {
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [choiceQuestion, textQuestion, { ...textQuestion, id: 303 }],
      );
      mockPrisma.assignment.findUnique.mockResolvedValue(
        baseAssignment({ questionOrder: [101, 202, 303] }),
      );

      const result = await read();

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.questions.map((q) => q.id)).toEqual([101, 202]);
    });

    it("excludes unserved and older duplicate responses from the numerator", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionOrder: [101],
        questionResponses: [
          response({ id: 1, questionId: 101, points: 3 }),
          response({ id: 2, questionId: 101, points: 5 }),
          response({ id: 3, questionId: 202, points: 5 }),
        ],
      });

      const result = await read();

      expect(result.totalPossiblePoints).toBe(5);
      expect(result.totalPointsEarned).toBe(5);
    });

    it("clamps a response graded above its question's max and recomputes the grade", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        grade: 1,
        questionResponses: [
          response({ id: 1, questionId: 101, points: 9 }),
          response({ id: 2, questionId: 202, points: 1 }),
        ],
      });

      const result = await read();

      expect(result.totalPointsEarned).toBe(6);
      expect(result.grade).toBeCloseTo(0.6);
      expect(result.questions[0].response?.points).toBe(5);
    });

    it("leaves the stored grade untouched when nothing was clamped", async () => {
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        grade: 0.7,
        questionResponses: [
          response({ id: 1, questionId: 101, points: 4 }),
          response({ id: 2, questionId: 202, points: 3 }),
        ],
      });

      const result = await read();

      expect(result.totalPointsEarned).toBe(7);
      expect(result.grade).toBe(0.7);
    });

    it("uses the original maximum from metadata when a served question was deleted", async () => {
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [choiceQuestion],
      );
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionResponses: [
          response({ id: 1, questionId: 101, points: 5 }),
          response({
            id: 2,
            questionId: 202,
            points: 4,
            metadata: JSON.stringify({ maxPossiblePoints: 5 }),
          }),
        ],
      });

      const result = await read();

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(9);
      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
    });

    it("falls back to the archived question row when metadata has no maximum", async () => {
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [choiceQuestion],
      );
      mockPrisma.question.findMany.mockResolvedValue([
        { id: 202, totalPoints: 5 },
      ]);
      mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
        ...baseAttempt(),
        questionResponses: [
          response({ id: 1, questionId: 101, points: 5 }),
          response({ id: 2, questionId: 202, points: 4, metadata: null }),
        ],
      });

      const result = await read();

      expect(mockPrisma.question.findMany).toHaveBeenCalledWith({
        where: { id: { in: [202] } },
        select: { id: true, totalPoints: true },
      });
      expect(result.totalPossiblePoints).toBe(10);
    });
  });
});
