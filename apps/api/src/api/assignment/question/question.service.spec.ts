import {
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, QuestionType } from "@prisma/client";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
import type { Logger } from "winston";
import type { QuestionDto } from "../dto/update.questions.request.dto";
import { QuestionService } from "./question.service";

describe("QuestionService question order sync", () => {
  let service: QuestionService;
  let tx: {
    assignment: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    question: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let prismaService: PrismaService & {
    $transaction: jest.Mock;
  };
  let llmFacadeService: Pick<LlmFacadeService, "applyGuardRails">;

  beforeEach(() => {
    tx = {
      assignment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      question: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    prismaService = {
      assignment: tx.assignment,
      question: tx.question,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService & {
      $transaction: jest.Mock;
    };

    llmFacadeService = {
      applyGuardRails: jest.fn().mockResolvedValue(true),
    };

    service = new QuestionService(
      prismaService,
      llmFacadeService as LlmFacadeService,
      {
        child: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
      } as any,
    );
  });

  it("appends a newly created question id to the persisted question order", async () => {
    tx.assignment.findUnique.mockResolvedValue({
      questionOrder: [20, 10],
      questions: [{ id: 10 }, { id: 20 }],
    });
    tx.question.create.mockResolvedValue({ id: 30 });

    const result = await service.create(1, {
      question: "New question",
      totalPoints: 1,
      type: QuestionType.TEXT,
    });

    expect(result).toEqual({ id: 30, success: true });
    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        questionOrder: [20, 10, 30],
      },
    });
  });

  it("repairs stale question order when creating a question", async () => {
    tx.assignment.findUnique.mockResolvedValue({
      questionOrder: [20],
      questions: [{ id: 10 }, { id: 20 }],
    });
    tx.question.create.mockResolvedValue({ id: 30 });

    await service.create(1, {
      question: "New question",
      totalPoints: 1,
      type: QuestionType.TEXT,
    });

    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        questionOrder: [20, 10, 30],
      },
    });
  });

  it("removes deleted question ids from the persisted question order", async () => {
    tx.question.findUnique.mockResolvedValue({ id: 20, assignmentId: 1 });
    tx.assignment.findUnique.mockResolvedValue({
      questionOrder: [30, 20, 10],
      questions: [{ id: 10 }, { id: 30 }],
    });
    tx.question.delete.mockResolvedValue({ id: 20 });

    const result = await service.remove(20);

    expect(result).toEqual({ id: 20, success: true });
    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        questionOrder: [30, 10],
      },
    });
  });

  it("throws when creating a question for a missing assignment", async () => {
    tx.assignment.findUnique.mockResolvedValue(null);

    await expect(
      service.create(999, {
        question: "Missing assignment question",
        totalPoints: 1,
        type: QuestionType.TEXT,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("QuestionService.generateTranslationIfNotExists", () => {
  const FRENCH = { code: "fr", name: "Français" };
  const question = {
    id: 7,
    assignmentId: 1,
    question: "What is 2 + 2?",
    type: QuestionType.SINGLE_CORRECT,
    totalPoints: 1,
    choices: [
      { id: 0, choice: "4", isCorrect: true, points: 1 },
      { id: 1, choice: "5", isCorrect: false, points: 0 },
    ],
  } as unknown as QuestionDto;

  let prisma: {
    translation: {
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
  };
  let llm: {
    generateQuestionTranslation: jest.Mock;
    generateChoicesTranslation: jest.Mock;
  };
  let service: QuestionService;

  beforeEach(() => {
    prisma = {
      translation: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    llm = {
      generateQuestionTranslation: jest.fn().mockResolvedValue("Combien?"),
      generateChoicesTranslation: jest.fn().mockResolvedValue([
        { id: 0, choice: "quatre" },
        { id: 1, choice: "cinq" },
      ]),
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    service = new QuestionService(
      prisma as unknown as PrismaService,
      llm as unknown as LlmFacadeService,
      { child: jest.fn().mockReturnValue(logger) } as unknown as Logger,
    );
  });

  it("serves a stored question-level translation without calling the LLM", async () => {
    prisma.translation.findFirst.mockResolvedValue({
      translatedText: "Combien font 2 + 2 ?",
      untranslatedText: "What is 2 + 2?",
      translatedChoices: JSON.stringify([{ id: 0, choice: "quatre" }]),
    });

    const result = await service.generateTranslationIfNotExists(
      1,
      question,
      FRENCH,
    );

    expect(result).toEqual({
      translatedQuestion: "Combien font 2 + 2 ?",
      translatedChoices: [{ id: 0, choice: "quatre" }],
    });
    expect(prisma.translation.findFirst).toHaveBeenCalledWith({
      where: { questionId: 7, variantId: null, languageCode: "fr" },
    });
    expect(llm.generateQuestionTranslation).not.toHaveBeenCalled();
  });

  it("replaces a stale row without touching variant translations", async () => {
    prisma.translation.findFirst.mockResolvedValue({
      translatedText: "Ancienne",
      untranslatedText: "An older wording",
      translatedChoices: null,
    });

    const result = await service.generateTranslationIfNotExists(
      1,
      question,
      FRENCH,
    );

    expect(prisma.translation.deleteMany).toHaveBeenCalledWith({
      where: { questionId: 7, variantId: null, languageCode: "fr" },
    });
    expect(llm.generateQuestionTranslation).toHaveBeenCalledWith(
      1,
      "What is 2 + 2?",
      "Français",
    );
    expect(prisma.translation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        questionId: 7,
        variantId: null,
        languageCode: "fr",
        translatedText: "Combien?",
      }) as unknown,
    });
    expect(result.translatedQuestion).toBe("Combien?");
  });

  it("answers an LLM failure or the AI kill switch with a retryable 503", async () => {
    llm.generateQuestionTranslation.mockRejectedValue(
      new Error("AI component AUTHORING is disabled"),
    );

    const error = await service
      .generateTranslationIfNotExists(1, question, FRENCH)
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      message: "Service temporarily unavailable",
    });
    expect(prisma.translation.create).not.toHaveBeenCalled();
  });

  it("serves the row a concurrent request stored first", async () => {
    prisma.translation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      translatedText: "Gagnant",
      untranslatedText: "What is 2 + 2?",
      translatedChoices: [{ id: 0, choice: "quatre" }],
    });
    prisma.translation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await service.generateTranslationIfNotExists(
      1,
      question,
      FRENCH,
    );

    expect(result).toEqual({
      translatedQuestion: "Gagnant",
      translatedChoices: [{ id: 0, choice: "quatre" }],
    });
  });

  it("rethrows other storage failures", async () => {
    prisma.translation.create.mockRejectedValue(new Error("db down"));

    await expect(
      service.generateTranslationIfNotExists(1, question, FRENCH),
    ).rejects.toThrow("db down");
  });
});
