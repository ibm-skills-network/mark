/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
          currentVersion: { include: { questionVersions: true } },
          versions: {
            where: { isActive: true },
            include: { questionVersions: true },
            orderBy: { id: "desc" },
            take: 1,
          },
          questions: {
            where: { isDeleted: false },
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
          currentVersion: { include: { questionVersions: true } },
          versions: {
            where: { isActive: true },
            include: { questionVersions: true },
            orderBy: { id: "desc" },
            take: 1,
          },
          questions: {
            where: { isDeleted: false },
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

    describe("version handling", () => {
      it("should use currentVersion when it exists and is active", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({
            id: assignmentId,
            name: "Original Assignment",
          }),
          questions: [],
          currentVersion: {
            id: 10,
            isActive: true,
            name: "Current Version Assignment",
            introduction: "Current version intro",
            questionVersions: [
              {
                id: 100,
                questionId: null,
                type: QuestionType.SINGLE_CORRECT,
                question: "Version question 1",
                totalPoints: 15,
                displayOrder: 1,
                responseType: null,
                maxWords: null,
                scoring: null,
                choices: null,
                randomizedChoices: null,
                answer: null,
                gradingContextQuestionIds: [],
                maxCharacters: null,
                videoPresentationConfig: null,
                liveRecordingConfig: null,
              },
            ],
          },
          versions: [
            {
              id: 11,
              isActive: true,
              name: "Other Active Version",
              questionVersions: [],
            },
          ],
        };

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.name).toBe("Current Version Assignment");
        expect(result.introduction).toBe("Current version intro");
        expect(result.questions).toBeDefined();
        expect(result.questions.length).toBe(1);
        expect(result.questions[0].question).toBe("Version question 1");
        expect(result.questions[0].totalPoints).toBe(15);
        expect(result.questions[0].id).toBe(-100); // Negative ID for version questions
      });

      it("should use versions[0] when currentVersion is not active", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({
            id: assignmentId,
            name: "Original Assignment",
          }),
          questions: [],
          currentVersion: {
            id: 10,
            isActive: false,
            name: "Inactive Current Version",
            questionVersions: [],
          },
          versions: [
            {
              id: 11,
              isActive: true,
              name: "Active Version From Array",
              introduction: "Active version intro",
              questionVersions: [
                {
                  id: 200,
                  questionId: 5,
                  type: QuestionType.MULTIPLE_CORRECT,
                  question: "Active version question",
                  totalPoints: 20,
                  displayOrder: 2,
                  responseType: "CHECKBOX",
                  maxWords: 100,
                  scoring: JSON.stringify({ type: "MANUAL" }),
                  choices: JSON.stringify([{ id: 1, choice: "Choice A" }]),
                  randomizedChoices: true,
                  answer: "Answer here",
                  gradingContextQuestionIds: [1, 2],
                  maxCharacters: 500,
                  videoPresentationConfig: JSON.stringify({ duration: 60 }),
                  liveRecordingConfig: JSON.stringify({ maxDuration: 120 }),
                },
              ],
            },
          ],
        };

        // Mock questions in the assignment
        mockAssignment.questions = [
          {
            id: 5,
            question: "Legacy question",
            type: QuestionType.MULTIPLE_CORRECT,
            isDeleted: false,
            variants: [
              {
                id: 501,
                questionId: 5,
                variantContent: "Legacy variant",
                isDeleted: false,
                choices: JSON.stringify([]),
              },
            ],
            assignmentId: 1,
          },
        ];

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.name).toBe("Active Version From Array");
        expect(result.introduction).toBe("Active version intro");
        expect(result.questions).toBeDefined();
        expect(result.questions.length).toBe(1);
        expect(result.questions[0].question).toBe("Active version question");
        expect(result.questions[0].totalPoints).toBe(20);
        expect(result.questions[0].id).toBe(5); // Uses questionId when available
        expect((result.questions[0] as any).variants).toBeDefined();
        expect((result.questions[0] as any).variants.length).toBe(1);
      });

      it("should fall back to original assignment when no active version exists", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({
            id: assignmentId,
            name: "Original Assignment",
          }),
          questions: [
            {
              id: 1,
              question: "Original question",
              type: QuestionType.SINGLE_CORRECT,
              isDeleted: false,
              variants: [],
              assignmentId: 1,
            },
          ],
          currentVersion: null,
          versions: [],
        };

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.name).toBe("Original Assignment");
        expect(result.questions).toBeDefined();
        expect(result.questions.length).toBe(1);
        expect(result.questions[0].question).toBe("Original question");
      });

      it("should handle questionVersions sorting by displayOrder and id", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({ id: assignmentId }),
          questions: [],
          currentVersion: {
            id: 10,
            isActive: true,
            questionVersions: [
              {
                id: 300,
                questionId: null,
                type: QuestionType.SINGLE_CORRECT,
                question: "Question with display order 3",
                totalPoints: 10,
                displayOrder: 3,
                responseType: null,
                maxWords: null,
                scoring: null,
                choices: null,
                randomizedChoices: null,
                answer: null,
                gradingContextQuestionIds: [],
                maxCharacters: null,
                videoPresentationConfig: null,
                liveRecordingConfig: null,
              },
              {
                id: 100,
                questionId: null,
                type: QuestionType.SINGLE_CORRECT,
                question: "Question with display order 1",
                totalPoints: 10,
                displayOrder: 1,
                responseType: null,
                maxWords: null,
                scoring: null,
                choices: null,
                randomizedChoices: null,
                answer: null,
                gradingContextQuestionIds: [],
                maxCharacters: null,
                videoPresentationConfig: null,
                liveRecordingConfig: null,
              },
              {
                id: 200,
                questionId: null,
                type: QuestionType.SINGLE_CORRECT,
                question: "Question with display order 1 but higher ID",
                totalPoints: 10,
                displayOrder: 1,
                responseType: null,
                maxWords: null,
                scoring: null,
                choices: null,
                randomizedChoices: null,
                answer: null,
                gradingContextQuestionIds: [],
                maxCharacters: null,
                videoPresentationConfig: null,
                liveRecordingConfig: null,
              },
            ],
          },
          versions: [],
        };

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.questions).toBeDefined();
        expect(result.questions.length).toBe(3);
        // Should be sorted by displayOrder first, then by id
        expect(result.questions[0].question).toBe(
          "Question with display order 1",
        );
        expect(result.questions[1].question).toBe(
          "Question with display order 1 but higher ID",
        );
        expect(result.questions[2].question).toBe(
          "Question with display order 3",
        );
      });

      it("should use activeVersion questionOrder over assignment questionOrder", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({ id: assignmentId }),
          questions: [],
          questionOrder: [3, 2, 1], // Original order
          currentVersion: {
            id: 10,
            isActive: true,
            questionOrder: [1, 2, 3], // Version order should take precedence
            questionVersions: [],
          },
          versions: [],
        };

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.questionOrder).toEqual([1, 2, 3]);
      });

      it("should fall back to assignment questionOrder when version has empty questionOrder", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          ...createMockAssignment({ id: assignmentId }),
          questions: [],
          questionOrder: [3, 2, 1],
          currentVersion: {
            id: 10,
            isActive: true,
            questionOrder: [], // Empty version order
            questionVersions: [],
          },
          versions: [],
        };

        jest
          .spyOn(prismaService.assignment, "findUnique")
          .mockResolvedValue(mockAssignment);

        const result = (await repository.findById(
          assignmentId,
          sampleAuthorSession,
        )) as GetAssignmentResponseDto;

        expect(result.questionOrder).toEqual([3, 2, 1]);
      });
    });
  });

  describe("edge cases and error scenarios", () => {
    it("should handle database connection errors gracefully", async () => {
      const assignmentId = 1;
      const databaseError = new Error("Database connection failed");

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockRejectedValue(databaseError);

      await expect(repository.findById(assignmentId)).rejects.toThrow(
        databaseError,
      );
    });

    it("should handle assignments with null questionVersions", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          questionVersions: null, // null instead of empty array
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(0);
    });

    it("should handle questionVersions with null displayOrder", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          questionVersions: [
            {
              id: 100,
              questionId: null,
              type: QuestionType.SINGLE_CORRECT,
              question: "Question with null displayOrder",
              totalPoints: 10,
              displayOrder: null, // null displayOrder
              responseType: null,
              maxWords: null,
              scoring: null,
              choices: null,
              randomizedChoices: null,
              answer: null,
              gradingContextQuestionIds: [],
              maxCharacters: null,
              videoPresentationConfig: null,
              liveRecordingConfig: null,
            },
            {
              id: 200,
              questionId: null,
              type: QuestionType.SINGLE_CORRECT,
              question: "Question with undefined displayOrder",
              totalPoints: 10,
              displayOrder: undefined, // undefined displayOrder
              responseType: null,
              maxWords: null,
              scoring: null,
              choices: null,
              randomizedChoices: null,
              answer: null,
              gradingContextQuestionIds: [],
              maxCharacters: null,
              videoPresentationConfig: null,
              liveRecordingConfig: null,
            },
          ],
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(2);
      // Should sort by ID when displayOrder is null/undefined
      expect(result.questions[0].id).toBe(-100);
      expect(result.questions[1].id).toBe(-200);
    });

    it("should handle assignments without userSession", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = await repository.findById(assignmentId);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      // Should default to author view when no userSession provided
      expect((result as GetAssignmentResponseDto).questions).toBeDefined();
    });

    it("should handle empty or undefined question arrays in processAssignmentData", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: undefined, // undefined questions
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions).toEqual([]);
    });

    it("should handle assignments with circular references in JSON fields", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [
          {
            id: 1,
            question: "Question with invalid JSON scoring",
            type: QuestionType.SINGLE_CORRECT,
            isDeleted: false,
            scoring: '{"type":"AUTO", invalid json', // Invalid JSON
            choices: "not json at all", // Invalid JSON
            variants: [],
            assignmentId: 1,
          },
        ],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);
      expect(result.questions[0].scoring).toBeUndefined();
      expect(result.questions[0].choices).toBeUndefined();
      expect(repository["logger"].error).toHaveBeenCalled();
    });

    it("should handle very large datasets efficiently", async () => {
      const assignmentId = 1;
      const largeQuestionSet = Array.from({ length: 1000 }, (_, index) => ({
        id: index + 1,
        question: `Question ${index + 1}`,
        type: QuestionType.SINGLE_CORRECT,
        isDeleted: false,
        scoring: JSON.stringify({ type: "AUTO" }),
        choices: JSON.stringify([{ id: 1, choice: "Answer", isCorrect: true }]),
        variants: [],
        assignmentId: 1,
      }));

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: largeQuestionSet,
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const start = Date.now();
      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;
      const end = Date.now();

      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1000);
      expect(end - start).toBeLessThan(5000); // Should complete within 5 seconds
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

    it("should handle authors by finding authored assignments", async () => {
      const mockAuthorAssignments = [
        createMockAssignment({ id: 1, name: "Authored Assignment 1" }),
        createMockAssignment({ id: 2, name: "Authored Assignment 2" }),
      ];

      // Mock the assignment.findMany for authors
      const mockAssignmentFindMany = jest
        .fn()
        .mockResolvedValue(mockAuthorAssignments);
      (prismaService.assignment as any).findMany = mockAssignmentFindMany;

      const result = await repository.findAllForUser(sampleAuthorSession);

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].name).toBe("Authored Assignment 1");
      expect(result[1].name).toBe("Authored Assignment 2");

      expect(mockAssignmentFindMany).toHaveBeenCalledWith({
        where: {
          AssignmentAuthor: {
            some: {
              userId: sampleAuthorSession.userId,
            },
          },
        },
      });
    });

    it("should handle database errors in findAllForUser", async () => {
      const databaseError = new Error("Database connection failed");

      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockRejectedValue(databaseError);

      await expect(
        repository.findAllForUser(sampleLearnerSession),
      ).rejects.toThrow(databaseError);
    });

    it("should handle null assignment groups result", async () => {
      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockResolvedValue(null);

      const result = await repository.findAllForUser(sampleLearnerSession);

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
        attemptsBeforeCoolDown: undefined,
        retakeAttemptCoolDownMinutes: undefined,
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

  describe("field merging logic", () => {
    it("should merge fields correctly with priority: primary > secondary > defaults", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({
          id: assignmentId,
          name: "Original Assignment",
          introduction: "Original intro",
          attemptsBeforeCoolDown: 3, // From assignment
        }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          name: "Version Assignment", // Should override
          // introduction is undefined in version, should fall back to assignment
          attemptsBeforeCoolDown: 5, // Should override assignment
          retakeAttemptCoolDownMinutes: 10, // Should override default
          questionVersions: [],
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      expect(result.name).toBe("Version Assignment"); // From version (primary)
      expect(result.introduction).toBe("Original intro"); // From assignment (secondary)
      expect(result.attemptsBeforeCoolDown).toBe(5); // From version (primary)
      expect(result.retakeAttemptCoolDownMinutes).toBe(10); // From version (primary)
      expect(result.passingGrade).toBe(50); // From defaults
      expect(result.graded).toBe(false); // From defaults
    });

    it("should handle null and undefined values in field merging correctly", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({
          id: assignmentId,
          name: null, // null in assignment
          introduction: undefined, // undefined in assignment
        }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          name: undefined, // undefined in version
          introduction: null, // null in version
          graded: null, // null should not override default
          questionVersions: [],
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // When both primary and secondary are null/undefined, should use defaults
      expect(result.name).toBeNull(); // prefer() returns null when all are null/undefined
      expect(result.introduction).toBeNull();
      expect(result.graded).toBe(false); // Should use default since version has null
    });

    it("should handle all field types in FIELDS constant", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          // Test various field types
          name: "Version Name",
          introduction: "Version Intro",
          instructions: "Version Instructions",
          gradingCriteriaOverview: "Version Grading",
          timeEstimateMinutes: 45,
          attemptsBeforeCoolDown: 2,
          retakeAttemptCoolDownMinutes: 15,
          type: "ASSIGNMENT",
          graded: true,
          numAttempts: 3,
          allotedTimeMinutes: 60,
          attemptsPerTimeRange: 5,
          attemptsTimeRangeHours: 24,
          passingGrade: 75,
          displayOrder: "RANDOM",
          questionDisplay: "ALL_AT_ONCE",
          numberOfQuestionsPerAttempt: 10,
          published: true,
          showAssignmentScore: false,
          showQuestionScore: false,
          showSubmissionFeedback: false,
          showQuestions: false,
          languageCode: "es-ES",
          questionVersions: [],
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // Verify all fields are properly merged from version
      expect(result.name).toBe("Version Name");
      expect(result.introduction).toBe("Version Intro");
      expect(result.instructions).toBe("Version Instructions");
      expect(result.gradingCriteriaOverview).toBe("Version Grading");
      expect(result.timeEstimateMinutes).toBe(45);
      expect(result.attemptsBeforeCoolDown).toBe(2);
      expect(result.retakeAttemptCoolDownMinutes).toBe(15);
      expect(result.graded).toBe(true);
      expect(result.numAttempts).toBe(3);
      expect(result.allotedTimeMinutes).toBe(60);
      expect(result.attemptsPerTimeRange).toBe(5);
      expect(result.attemptsTimeRangeHours).toBe(24);
      expect(result.passingGrade).toBe(75);
      expect(result.questionDisplay).toBe("ALL_AT_ONCE");
      expect(result.numberOfQuestionsPerAttempt).toBe(10);
      expect(result.published).toBe(true);
      expect(result.showAssignmentScore).toBe(false);
      expect(result.showQuestionScore).toBe(false);
      expect(result.showSubmissionFeedback).toBe(false);
      expect(result.showQuestions).toBe(false);
      expect((result as any).languageCode).toBe("es-ES");
    });
  });

  describe("integration tests", () => {
    it("should handle complex merging scenarios in real usage", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({
          id: assignmentId,
          name: "Assignment Name",
          introduction: null, // null in assignment
          attemptsBeforeCoolDown: undefined, // undefined in assignment
        }),
        questions: [],
        currentVersion: {
          id: 10,
          isActive: true,
          name: null, // null in version, should fall back to assignment
          introduction: "Version Introduction", // should override null assignment value
          attemptsBeforeCoolDown: 3, // should override undefined assignment value
          retakeAttemptCoolDownMinutes: undefined, // undefined in version, should use default
          questionVersions: [],
        },
        versions: [],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // This test verifies the merging logic works correctly in practice
      expect(result.name).toBe("Assignment Name"); // Falls back to assignment when version is null
      expect(result.introduction).toBe("Version Introduction"); // Version overrides null assignment
      expect(result.attemptsBeforeCoolDown).toBe(3); // Version overrides undefined assignment
      expect(result.retakeAttemptCoolDownMinutes).toBe(5); // Uses default when both are null/undefined
    });

    it("should maintain data integrity across different user roles", async () => {
      const assignmentId = 1;
      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: [
          {
            id: 1,
            question: "Test question",
            type: QuestionType.SINGLE_CORRECT,
            isDeleted: false,
            variants: [],
            assignmentId: 1,
          },
        ],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      // Test author view
      const authorResult = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // Test learner view
      const learnerResult = await repository.findById(
        assignmentId,
        sampleLearnerSession,
      );

      expect(authorResult.questions).toBeDefined();
      expect(authorResult.questions.length).toBe(1);
      expect(learnerResult.questions).toBeUndefined(); // Learners shouldn't see questions
      expect(authorResult.success).toBe(true);
      expect(learnerResult.success).toBe(true);
    });
  });
});
