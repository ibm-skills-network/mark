import { NotFoundException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
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
