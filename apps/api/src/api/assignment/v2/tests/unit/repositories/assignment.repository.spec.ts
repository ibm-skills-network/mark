/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/unbound-method */
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { GetAssignmentResponseDto } from "src/api/assignment/dto/get.assignment.response.dto";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "src/prisma.service";
import {
  createMockAssignment,
  sampleAuthorSession,
  sampleLearnerSession,
} from "../__mocks__/ common-mocks";
import { AssignmentRepository } from "../../../repositories/assignment.repository";

describe("AssignmentRepository", () => {
  let repository: AssignmentRepository;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const mockPrismaService = {
      assignment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      assignmentGroup: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<AssignmentRepository>(AssignmentRepository);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(repository).toBeDefined();
  });

  describe("findById", () => {
    it("should find and return an assignment for an author", async () => {
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [
            {
              id: 101,
              questionId: 1,
              variantContent: "What is the capital city of France?",
              isDeleted: false,
              choices: JSON.stringify([
                { id: 1, choice: "Paris", isCorrect: true, points: 10 },
                { id: 2, choice: "London", isCorrect: false, points: 0 },
              ]),
            },
          ],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = await repository.findById(
        assignmentId,
        sampleAuthorSession,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);

      global.JSON.parse = originalJsonParse;

      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
        include: {
          questions: {
            include: { variants: true },
          },
        },
      });
    });

    it("should find and return an assignment for a learner (without questions)", async () => {
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = await repository.findById(
        assignmentId,
        sampleLearnerSession,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeUndefined();

      global.JSON.parse = originalJsonParse;
    });

    it("should throw NotFoundException if assignment is not found", async () => {
      const assignmentId = 999;
      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(null);

      await expect(repository.findById(assignmentId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
        include: {
          questions: {
            include: { variants: true },
          },
        },
      });
    });

    it("should filter out deleted questions and variants", async () => {
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [
            {
              id: 101,
              questionId: 1,
              variantContent: "What is the capital city of France?",
              isDeleted: false,
              choices: JSON.stringify([]),
            },
            {
              id: 102,
              questionId: 1,
              variantContent: "Paris is the capital of which country?",
              isDeleted: true,
              choices: JSON.stringify([]),
            },
          ],
          assignmentId: 1,
        },

        {
          id: 2,
          question: "What is the capital of Germany?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: true,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
        questionOrder: [1, 2],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);
      expect(result.questions[0].id).toBe(1);

      global.JSON.parse = originalJsonParse;
    });

    it("should sort questions based on questionOrder if available", async () => {
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 3,
          question: "Question 3",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
        {
          id: 1,
          question: "Question 1",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
        {
          id: 2,
          question: "Question 2",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
        questionOrder: [2, 1, 3],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(3);

      expect(result.questions[0].id).toBe(2);
      expect(result.questions[1].id).toBe(1);
      expect(result.questions[2].id).toBe(3);

      global.JSON.parse = originalJsonParse;
    });
  });

  describe("findAllForUser", () => {
    it("should return all assignments for a user", async () => {
      const mockAssignmentGroups = [
        {
          groupId: "group1",
          assignmentId: 1,
          assignment: createMockAssignment({ id: 1, name: "Assignment 1" }),
        },
        {
          groupId: "group1",
          assignmentId: 2,
          assignment: createMockAssignment({ id: 2, name: "Assignment 2" }),
        },
      ];

      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockResolvedValue(mockAssignmentGroups);

      const result = await repository.findAllForUser(sampleLearnerSession);

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Assignment 1");
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Assignment 2");

      expect(prismaService.assignmentGroup.findMany).toHaveBeenCalledWith({
        where: { groupId: sampleLearnerSession.groupId },
        include: { assignment: true },
      });
    });

    it("should return an empty array if no assignments are found", async () => {
      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockResolvedValue([]);

      const result = await repository.findAllForUser(sampleLearnerSession);

      expect(result).toBeDefined();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("should update an assignment successfully", async () => {
      const assignmentId = 1;
      const updateData = {
        name: "Updated Assignment Name",
        introduction: "Updated introduction",
      };

      const updatedAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        ...updateData,
      };

      jest
        .spyOn(prismaService.assignment, "update")
        .mockResolvedValue(updatedAssignment);

      const result = await repository.update(assignmentId, updateData);

      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.name).toBe(updateData.name);
      expect(result.introduction).toBe(updateData.introduction);

      expect(prismaService.assignment.update).toHaveBeenCalledWith({
        where: { id: assignmentId },
        data: updateData,
      });
    });

    it("should throw and log errors during update", async () => {
      const assignmentId = 1;
      const updateData = { name: "Updated Assignment" };
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.assignment, "update")
        .mockRejectedValue(mockError);
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      await expect(repository.update(assignmentId, updateData)).rejects.toThrow(
        mockError,
      );
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("replace", () => {
    it("should replace an assignment with new data", async () => {
      const assignmentId = 1;
      const replaceData = {
        name: "Completely New Assignment",
        introduction: "Brand new introduction",
        instructions: "New instructions",
      };

      const expectedData: Record<string, unknown> = {
        ...repository["createEmptyDto"](),
        ...replaceData,
      };

      const replacedAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        ...replaceData,
      };

      jest
        .spyOn(prismaService.assignment, "update")
        .mockResolvedValue(replacedAssignment);
      jest.spyOn(repository as any, "createEmptyDto").mockReturnValue({
        instructions: undefined,
        numAttempts: undefined,
        allotedTimeMinutes: undefined,
        attemptsPerTimeRange: undefined,
        attemptsTimeRangeHours: undefined,
        displayOrder: undefined,
      });

      const result = await repository.replace(assignmentId, replaceData);

      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.name).toBe(replaceData.name);
      expect(result.introduction).toBe(replaceData.introduction);
      expect(result.instructions).toBe(replaceData.instructions);

      expect(prismaService.assignment.update).toHaveBeenCalledWith({
        where: { id: assignmentId },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining(expectedData),
      });
    });

    it("should throw and log errors during replace", async () => {
      const assignmentId = 1;
      const replaceData = { name: "Completely New Assignment" };
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.assignment, "update")
        .mockRejectedValue(mockError);
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      await expect(
        repository.replace(assignmentId, replaceData),
      ).rejects.toThrow(mockError);
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("parseJsonField", () => {
    it("should parse a JSON string to the correct type", () => {
      const jsonString = '{"type":"AUTO","rubrics":[]}';

      const result = repository["parseJsonField"]<ScoringDto>(jsonString);

      expect(result).toBeDefined();
      expect(result).toEqual({
        type: "AUTO",
        rubrics: [],
      });
    });

    it("should return undefined for null input", () => {
      const result = repository["parseJsonField"](null);

      expect(result).toBeUndefined();
    });

    it("should return the input as-is if not a string", () => {
      const jsonObject = { type: "AUTO", rubrics: [] };

      const result = repository["parseJsonField"](jsonObject);

      expect(result).toBe(jsonObject);
    });

    it("should handle invalid JSON and return undefined", () => {
      const invalidJson = '{"type":"AUTO", invalid json}';
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      const result = repository["parseJsonField"](invalidJson);

      expect(result).toBeUndefined();
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("createEmptyDto", () => {
    it("should return an empty assignment DTO with undefined values", () => {
      const result = repository["createEmptyDto"]();

      expect(result).toBeDefined();
      expect(result.instructions).toBeUndefined();
      expect(result.numAttempts).toBeUndefined();
      expect(result.allotedTimeMinutes).toBeUndefined();
      expect(result.attemptsPerTimeRange).toBeUndefined();
      expect(result.attemptsTimeRangeHours).toBeUndefined();
      expect(result.displayOrder).toBeUndefined();
    });
  });

  describe("processAssignmentData", () => {
    it("should process raw assignment data with questions and variants", () => {
      const rawAssignment = {
        ...createMockAssignment({ id: 1 }),
        questions: [
          {
            id: 1,
            question: "What is the capital of France?",
            type: QuestionType.SINGLE_CORRECT,
            isDeleted: false,
            scoring: JSON.stringify({ type: "AUTO" }),
            choices: JSON.stringify([
              { id: 1, choice: "Paris", isCorrect: true, points: 10 },
              { id: 2, choice: "London", isCorrect: false, points: 0 },
            ]),
            variants: [
              {
                id: 101,
                questionId: 1,
                variantContent: "What is the capital city of France?",
                isDeleted: false,
                choices: JSON.stringify([
                  { id: 1, choice: "Paris", isCorrect: true, points: 10 },
                  { id: 2, choice: "London", isCorrect: false, points: 0 },
                ]),
              },
            ],
            assignmentId: 1,
          },
        ],
      };

      jest
        .spyOn(repository as any, "parseJsonField")
        .mockImplementation((jsonValue) => {
          if (typeof jsonValue === "string") {
            try {
              return JSON.parse(jsonValue) as unknown;
            } catch {
              return;
            }
          }
          return jsonValue;
        });

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = repository["processAssignmentData"](rawAssignment as any);

      expect(result).toBeDefined();
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);

      const processedQuestion = result.questions[0];
      expect(processedQuestion.id).toBe(1);
      expect(processedQuestion.scoring).toEqual({ type: "AUTO" });
      expect(Array.isArray(processedQuestion.choices)).toBe(true);
      expect(processedQuestion.choices.length).toBe(2);

      expect(processedQuestion.variants).toBeDefined();
      expect(processedQuestion.variants.length).toBe(1);
      expect(processedQuestion.variants[0].id).toBe(101);
      expect(Array.isArray(processedQuestion.variants[0].choices)).toBe(true);

      global.JSON.parse = originalJsonParse;
    });

    it("should handle missing or empty questions array", () => {
      const rawAssignment = {
        ...createMockAssignment({ id: 1 }),
        questions: undefined,
      };

      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      const result = repository["processAssignmentData"](rawAssignment as any);

      expect(result).toBeDefined();
      expect(result.questions).toEqual([]);

      global.JSON.parse = originalJsonParse;
    });
  });
});
