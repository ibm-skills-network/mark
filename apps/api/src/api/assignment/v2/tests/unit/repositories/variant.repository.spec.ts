/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/no-null */
import { Test, TestingModule } from "@nestjs/testing";
import { Prisma, VariantType } from "@prisma/client";
import { VariantDto } from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "src/prisma.service";
import {
  createMockPrismaService,
  createMockQuestionVariant,
  createMockVariantDto,
  sampleChoiceA,
  sampleChoiceB,
  sampleChoiceC,
} from "../__mocks__/ common-mocks";
import { VariantRepository } from "../../../repositories/variant.repository";

describe("VariantRepository", () => {
  let variantRepository: VariantRepository;
  let prismaService: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prismaService = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariantRepository,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    variantRepository = module.get<VariantRepository>(VariantRepository);
  });
  describe("findById", () => {
    it("should find a variant by ID", async () => {
      const mockVariant = createMockQuestionVariant();
      prismaService.questionVariant.findUnique.mockResolvedValue(mockVariant);

      const result = await variantRepository.findById(mockVariant.id);

      expect(prismaService.questionVariant.findUnique).toHaveBeenCalledWith({
        where: { id: mockVariant.id },
      });
      expect(result).toEqual(mockVariant);
    });

    it("should return null if variant is not found", async () => {
      prismaService.questionVariant.findUnique.mockResolvedValue(null);

      const result = await variantRepository.findById(999);

      expect(prismaService.questionVariant.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
      });
      expect(result).toBeNull();
    });
  });

  describe("findByQuestionId", () => {
    it("should find all non-deleted variants for a question", async () => {
      const mockVariants = [
        createMockQuestionVariant({ id: 101, questionId: 1 }),
        createMockQuestionVariant({ id: 102, questionId: 1 }),
      ];
      prismaService.questionVariant.findMany.mockResolvedValue(mockVariants);

      const result = await variantRepository.findByQuestionId(1);

      expect(prismaService.questionVariant.findMany).toHaveBeenCalledWith({
        where: {
          questionId: 1,
          isDeleted: false,
        },
      });
      expect(result).toEqual(mockVariants);
    });

    it("should handle errors when finding variants", async () => {
      const error = new Error("Database error");
      prismaService.questionVariant.findMany.mockRejectedValue(error);

      await expect(variantRepository.findByQuestionId(1)).rejects.toThrow(
        error,
      );
    });
  });

  describe("create", () => {
    it("should create a new variant", async () => {
      const variantDto = createMockVariantDto({ id: undefined });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const mockCreatedVariant = createMockQuestionVariant({ questionId });
      prismaService.questionVariant.create.mockResolvedValue(
        mockCreatedVariant,
      );

      jest
        .spyOn(variantRepository as any, "prepareVariantCreateData")
        .mockReturnValue({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          createdAt: new Date(),
          choices: JSON.stringify([
            sampleChoiceA,
            sampleChoiceB,
            sampleChoiceC,
          ]),
          scoring: null,
          variantOf: {
            connect: { id: questionId },
          },
        });

      const result = await variantRepository.create(dataWithQuestionId);

      expect(prismaService.questionVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining<
          Partial<Prisma.QuestionVariantCreateInput>
        >({
          variantContent: variantDto.variantContent,
          variantOf: {
            connect: { id: questionId },
          },
        }),
      });
      expect(result).toEqual(mockCreatedVariant);
    });

    it("should handle errors when creating a variant", async () => {
      const variantDto = createMockVariantDto();
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const error = new Error("Database error");
      prismaService.questionVariant.create.mockRejectedValue(error);

      await expect(
        variantRepository.create(dataWithQuestionId),
      ).rejects.toThrow(error);
    });
  });

  describe("update", () => {
    it("should update an existing variant", async () => {
      const variantId = 101;
      const variantDto = createMockVariantDto({ id: variantId });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const mockUpdatedVariant = createMockQuestionVariant({
        id: variantId,
        questionId,
      });
      prismaService.questionVariant.update.mockResolvedValue(
        mockUpdatedVariant,
      );

      jest
        .spyOn<any, any>(variantRepository, "prepareVariantUpdateData")
        .mockReturnValue({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          choices: JSON.stringify([
            sampleChoiceA,
            sampleChoiceB,
            sampleChoiceC,
          ]),
          scoring: null,
        });

      const result = await variantRepository.update(
        variantId,
        dataWithQuestionId,
      );

      expect(prismaService.questionVariant.update).toHaveBeenCalledWith({
        where: { id: variantId },
        data: expect.objectContaining({
          variantContent: variantDto.variantContent,
        }),
      });
      expect(result).toEqual(mockUpdatedVariant);
    });

    it("should handle errors when updating a variant", async () => {
      const variantId = 101;
      const variantDto = createMockVariantDto({ id: variantId });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const error = new Error("Database error");
      prismaService.questionVariant.update.mockRejectedValue(error);

      await expect(
        variantRepository.update(variantId, dataWithQuestionId),
      ).rejects.toThrow(error);
    });
  });

  describe("markAsDeleted", () => {
    it("should mark variants as deleted", async () => {
      const variantIds = [101, 102];
      prismaService.questionVariant.updateMany.mockResolvedValue({ count: 2 });

      await variantRepository.markAsDeleted(variantIds);

      expect(prismaService.questionVariant.updateMany).toHaveBeenCalledWith({
        where: { id: { in: variantIds } },
        data: { isDeleted: true },
      });
    });

    it("should do nothing when given an empty array", async () => {
      await variantRepository.markAsDeleted([]);

      expect(prismaService.questionVariant.updateMany).not.toHaveBeenCalled();
    });

    it("should handle errors when marking variants as deleted", async () => {
      const variantIds = [101, 102];
      const error = new Error("Database error");
      prismaService.questionVariant.updateMany.mockRejectedValue(error);

      await expect(variantRepository.markAsDeleted(variantIds)).rejects.toThrow(
        error,
      );
    });
  });

  describe("createMany", () => {
    it("should create multiple variants in a transaction", async () => {
      const variantDtos = [
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
      ];

      const mockCreatedVariants = [
        createMockQuestionVariant({ id: 201, questionId: 1 }),
        createMockQuestionVariant({ id: 202, questionId: 1 }),
      ];

      prismaService.$transaction.mockResolvedValue(mockCreatedVariants);

      jest
        .spyOn<any, any>(variantRepository, "prepareVariantCreateData")
        .mockImplementation((...arguments_: unknown[]) => {
          const data = arguments_[0] as VariantDto & { questionId: number };
          return {
            variantContent: data.variantContent,
            maxWords: data.maxWords,
            maxCharacters: data.maxCharacters,
            randomizedChoices: data.randomizedChoices,
            variantType: data.variantType,
            createdAt: expect.any(Date),
            choices: JSON.stringify([
              sampleChoiceA,
              sampleChoiceB,
              sampleChoiceC,
            ]),
            scoring: null,
            variantOf: {
              connect: { id: data.questionId },
            },
          };
        });

      const result = await variantRepository.createMany(variantDtos);

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedVariants);
    });

    it("should return an empty array when given an empty array", async () => {
      const result = await variantRepository.createMany([]);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should handle errors when creating multiple variants", async () => {
      const variantDtos = [
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
      ];

      const error = new Error("Transaction error");
      prismaService.$transaction.mockRejectedValue(error);

      await expect(variantRepository.createMany(variantDtos)).rejects.toThrow(
        error,
      );
    });
  });

  describe("mapToVariantDto", () => {
    it("should map a database variant to a DTO", () => {
      const mockVariant = createMockQuestionVariant();

      jest
        .spyOn<any, any>(variantRepository, "parseJsonField")
        .mockImplementation((field) => {
          if (field === mockVariant.choices)
            return [sampleChoiceA, sampleChoiceB, sampleChoiceC];
          if (field === mockVariant.scoring) return null;
          return undefined;
        });

      const result = variantRepository.mapToVariantDto(mockVariant);

      expect(result).toEqual({
        id: mockVariant.id,
        questionId: mockVariant.questionId,
        variantContent: mockVariant.variantContent,
        choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
        scoring: null,
        maxWords: mockVariant.maxWords,
        maxCharacters: mockVariant.maxCharacters,
        randomizedChoices: mockVariant.randomizedChoices,
        variantType: VariantType.REWORDED,
      });
    });
  });

  describe("private methods", () => {
    describe("prepareJsonField", () => {
      it("should return undefined for undefined input", () => {
        const result = (variantRepository as any).prepareJsonField(undefined);

        expect(result).toBeUndefined();
      });

      it("should return null for null input", () => {
        const result = (variantRepository as any).prepareJsonField(null);

        expect(result).toBeNull();
      });

      it("should return the input if it is already a JSON string", () => {
        const jsonString = JSON.stringify({ test: "value" });

        const result = (variantRepository as any).prepareJsonField(jsonString);

        expect(result).toBe(jsonString);
      });

      it("should stringify non-JSON string input", () => {
        const nonJsonString = "test string";

        const result = (variantRepository as any).prepareJsonField(
          nonJsonString,
        );

        expect(result).toBe('"test string"');
      });

      it("should stringify object input", () => {
        const object = { test: "value" };

        const result = (variantRepository as any).prepareJsonField(object);

        expect(result).toBe(JSON.stringify(object));
      });
    });

    describe("parseJsonField", () => {
      it("should return undefined for undefined input", () => {
        const result = (variantRepository as any).parseJsonField(undefined);

        expect(result).toBeUndefined();
      });

      it("should return undefined for null input", () => {
        const result = (variantRepository as any).parseJsonField(null);

        expect(result).toBeUndefined();
      });

      it("should parse JSON string input", () => {
        const jsonString = JSON.stringify({ test: "value" });

        const result = (variantRepository as any).parseJsonField(jsonString);

        expect(result).toEqual({ test: "value" });
      });

      it("should return undefined for invalid JSON string input", () => {
        const invalidJsonString = "not valid json";

        const result = (variantRepository as any).parseJsonField(
          invalidJsonString,
        );

        expect(result).toBeUndefined();
      });

      it("should return the input as is for non-string input", () => {
        const object = { test: "value" };

        const result = (variantRepository as any).parseJsonField(object);

        expect(result).toBe(object);
      });
    });

    describe("prepareVariantCreateData", () => {
      it("should throw an error for invalid input", () => {
        expect(() =>
          (variantRepository as any).prepareVariantCreateData(null),
        ).toThrow("Invalid variant data");
      });

      it("should throw an error when variant content is missing", () => {
        const invalidVariantDto = {
          ...createMockVariantDto(),
          variantContent: undefined,
        };

        expect(() =>
          (variantRepository as any).prepareVariantCreateData(
            invalidVariantDto,
          ),
        ).toThrow("Variant content is required");
      });

      it("should prepare valid data for create operation", () => {
        const variantDto = createMockVariantDto();
        const questionId = 1;
        const dataWithQuestionId = { ...variantDto, questionId };

        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation((field) => {
            if (field === variantDto.choices) return JSON.stringify(field);
            if (field === variantDto.scoring) return null;
            return undefined;
          });

        const result = (variantRepository as any).prepareVariantCreateData(
          dataWithQuestionId,
        );

        expect(result).toEqual({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          createdAt: expect.any(Date),
          choices: JSON.stringify(variantDto.choices),
          scoring: null,
          variantOf: {
            connect: { id: questionId },
          },
        });
      });

      it("should handle errors during preparation", () => {
        const variantDto = createMockVariantDto();
        const questionId = 1;
        const dataWithQuestionId = { ...variantDto, questionId };

        const error = new Error("Processing error");
        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation(() => {
            throw error;
          });

        expect(() =>
          (variantRepository as any).prepareVariantCreateData(
            dataWithQuestionId,
          ),
        ).toThrow(error);
      });
    });

    describe("prepareVariantUpdateData", () => {
      it("should throw an error for invalid input", () => {
        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(null),
        ).toThrow("Invalid variant data");
      });

      it("should throw an error when variant content is missing", () => {
        const invalidVariantDto = {
          ...createMockVariantDto(),
          variantContent: undefined,
        };

        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(
            invalidVariantDto,
          ),
        ).toThrow("Variant content is required");
      });

      it("should prepare valid data for update operation", () => {
        const variantDto = createMockVariantDto();

        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation((field) => {
            if (field === variantDto.choices) return JSON.stringify(field);
            if (field === variantDto.scoring) return null;
            return undefined;
          });

        const result = (variantRepository as any).prepareVariantUpdateData(
          variantDto,
        );

        expect(result).toEqual({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          choices: JSON.stringify(variantDto.choices),
          scoring: null,
        });
      });

      it("should handle errors during preparation", () => {
        const variantDto = createMockVariantDto();

        const error = new Error("Processing error");
        jest
          .spyOn(variantRepository as any, "prepareJsonField")
          .mockImplementation(() => {
            throw error;
          });

        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(variantDto),
        ).toThrow(error);
      });
    });
  });
});
