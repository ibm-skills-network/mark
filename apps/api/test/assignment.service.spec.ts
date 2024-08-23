import { HttpService } from "@nestjs/axios";
import { Test, TestingModule } from "@nestjs/testing";
import { AxiosResponse } from "axios";
import each from "jest-each";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { of } from "rxjs";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AssignmentService } from "../src/api/assignment/assignment.service";
import { AttemptService } from "../src/api/assignment/attempt/attempt.service";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { QuestionService } from "../src/api/assignment/question/question.service";
import { LlmService } from "../src/api/llm/llm.service";
import { PrismaService } from "../src/prisma.service";

interface TestCase {
  totalPoints: number[];
  earnedPoints: number[];
}

jest.mock("winston", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

describe("AttemptService", () => {
  let service: AttemptService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptService,
        PrismaService,
        LlmService,
        QuestionService,
        AssignmentService,
        {
          provide: HttpService,
          useValue: {
            put: jest.fn().mockImplementation(() => of({} as AxiosResponse)),
          },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            child: jest.fn().mockReturnThis(),
          },
        },
      ],
    }).compile();

    service = module.get<AttemptService>(AttemptService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  const generateRandomPoints = (): TestCase => {
    const totalPoints = Array.from(
      { length: 5 },
      () => Math.floor(Math.random() * 100) + 1,
    );
    const earnedPoints = totalPoints.map((points) =>
      Math.floor(Math.random() * points),
    );
    return { totalPoints, earnedPoints };
  };

  const testCases: TestCase[] = Array.from(
    { length: 10 },
    generateRandomPoints,
  );

  each(testCases).test(
    "should calculate and update the grade correctly for randomized points",
    async ({ totalPoints, earnedPoints }: TestCase) => {
      // Mock data
      const assignmentAttemptId = 1;
      const assignmentId = 1;

      const mockResponses = earnedPoints.map((points, index) => ({
        questionId: index + 1,
        points,
      }));
      const updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto =
        {
          submitted: true,
          responsesForQuestions: mockResponses.map(({ questionId }) => ({
            id: questionId,
            learnerAnswerChoice: undefined,
            learnerAnswerText: undefined,
            learnerChoices: undefined,
            learnerTextResponse: "what is your name",
            learnerUrlResponse: undefined,
            learnerFileResponse: undefined,
          })),
        };
      const authCookie = "someAuthCookie";
      const gradingCallbackRequired = false;

      const mockAssignment = {
        id: assignmentId,
        showAssignmentScore: true,
        showQuestionScore: true,
        showSubmissionFeedback: true,
        questions: totalPoints.map((points, index) => ({
          id: index + 1,
          totalPoints: points,
        })),
      };

      const mockAssignmentAttempt: LearnerUpdateAssignmentAttemptRequestDto & {
        id: number;
        expiresAt: Date;
      } = {
        id: assignmentAttemptId,
        submitted: false,
        responsesForQuestions: updateAssignmentAttemptDto.responsesForQuestions,
        expiresAt: new Date(Date.now() + 1_000_000), // future date
      };

      const mockQuestionResponses: CreateQuestionResponseAttemptResponseDto[] =
        mockResponses.map((response, index) => ({
          id: index + 1,
          questionId: response.questionId,
          feedback: [
            {
              feedback: "that's right!",
            },
          ],
          totalPoints: response.points,
          question: "What is your name",
        }));

      // service.createQuestionResponse = jest
      //   .fn()
      //   .mockResolvedValue(mockQuestionResponses);

      service.createQuestionResponse = jest
        .fn()
        .mockImplementation(
          (
            assignmentAttemptId,
            questionId: number,
            _createQuestionResponse,
          ) => {
            return Promise.resolve(
              mockQuestionResponses.find(
                (response) => response.questionId === questionId,
              ) || { id: 1, questionId, totalPoints: 0, feedback: [] },
            );
          },
        );

      prisma.assignment.findUnique = jest
        .fn()
        .mockReturnValueOnce(mockAssignment);
      prisma.questionResponse.findMany = jest
        .fn()
        .mockReturnValueOnce(mockResponses);
      prisma.assignmentAttempt.findUnique = jest
        .fn()
        .mockReturnValueOnce(mockAssignmentAttempt);
      prisma.assignmentAttempt.update = jest
        .fn()
        .mockImplementationOnce(
          (parameters: {
            where: { id: number };
            data: { grade: number; submitted: boolean };
          }) => {
            return {
              id: parameters.where.id,
              grade: parameters.data.grade,
              submitted: parameters.data.submitted,
              success: true,
            };
          },
        );

      // Execute the method
      const result = await service.updateAssignmentAttempt(
        assignmentAttemptId,
        assignmentId,
        updateAssignmentAttemptDto,
        authCookie,
        gradingCallbackRequired,
      );
      // Calculate expected grade
      const totalPointsPossible = totalPoints.reduce(
        (sum, points) => sum + points,
        0,
      );
      const totalPointsEarned = earnedPoints.reduce(
        (sum, points) => sum + points,
        0,
      );
      const expectedGrade = totalPointsEarned / totalPointsPossible;
      // Verify the result
      expect(result.grade).toBeCloseTo(expectedGrade, 4);
      expect(result.submitted).toBe(true);
      expect(result.success).toBe(true);
    },
  );
});
