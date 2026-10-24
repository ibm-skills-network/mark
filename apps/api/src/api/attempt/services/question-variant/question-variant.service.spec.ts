import { Prisma } from "@prisma/client";
import type { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import type { PrismaService } from "../../../../database/prisma.service";
import { QuestionVariantService } from "./question-variant.service";

describe("QuestionVariantService.createAttemptQuestionVariants", () => {
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    assignmentAttemptQuestionVariant: { createMany },
  } as unknown as PrismaService;
  const service = new QuestionVariantService(prisma);

  beforeEach(() => createMany.mockClear());

  const rowsWritten = () =>
    (createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> })
      .data;

  it.each([
    ["a stored object", { a: 1 }],
    ["JSON text of an object", '{"a":1}'],
  ])("writes DbNull, never a bare null, for %s", async (_label, choices) => {
    await service.createAttemptQuestionVariants(7, [
      { id: 1, choices, variants: [] } as unknown as QuestionDto,
    ]);

    const [row] = rowsWritten();
    expect(row.randomizedChoices).toBe(Prisma.DbNull);
    expect(row).toMatchObject({
      assignmentAttemptId: 7,
      questionId: 1,
      questionVariantId: null,
    });
  });

  it.each([
    ["no choices", undefined],
    ["unparsable choice text", "not json"],
  ])("stores an empty list for %s", async (_label, choices) => {
    await service.createAttemptQuestionVariants(7, [
      { id: 1, choices, variants: [] } as unknown as QuestionDto,
    ]);

    expect(rowsWritten()[0].randomizedChoices).toBe("[]");
  });

  it("stores usable choices as JSON text", async () => {
    const choices = [{ id: 1, choice: "A" }];
    await service.createAttemptQuestionVariants(7, [
      { id: 1, choices, variants: [] } as unknown as QuestionDto,
    ]);

    expect(rowsWritten()[0].randomizedChoices).toBe(JSON.stringify(choices));
  });
});
