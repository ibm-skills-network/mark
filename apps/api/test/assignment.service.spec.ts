import { Test, TestingModule } from "@nestjs/testing";
import { AttemptService } from "../src/api/assignment/attempt/attempt.service";
import { PrismaService } from "../src/prisma.service";
import { HttpService } from "@nestjs/axios";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { of } from "rxjs";
import { LlmService } from "../src/api/llm/llm.service";
import { QuestionService } from "../src/api/assignment/question/question.service";
import { AssignmentService } from "../src/api/assignment/assignment.service";
import { AxiosResponse } from "axios";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import each from "jest-each";

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
      const updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto =
        {
          submitted: true,
        };
      const authCookie = "someAuthCookie";
      const gradingCallbackRequired = false;

      const mockAssignment = {
        id: assignmentId,
        questions: totalPoints.map((points, index) => ({
          id: index + 1,
          totalPoints: points,
        })),
      };

      const mockResponses = earnedPoints.map((points, index) => ({
        questionId: index + 1,
        points,
      }));

      const mockAssignmentAttempt = {
        id: assignmentAttemptId,
        expiresAt: new Date(Date.now() + 1_000_000), // future date
      };

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
