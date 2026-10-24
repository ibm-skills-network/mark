import { GradingProgressService } from "./grading-progress.service";

describe("GradingProgressService failure payload", () => {
  const failure = {
    kind: "unable_to_grade" as const,
    issues: [
      {
        questionId: 9,
        code: "file_encrypted" as const,
        source: { kind: "file" as const, fileName: "report.docx" },
        retryable: false,
        message: '"report.docx" is password-protected, so we can\'t read it.',
      },
    ],
  };

  function serviceWith(row: Record<string, unknown> | null) {
    const prisma = {
      gradingProgress: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(row),
      },
    };
    const service = new GradingProgressService(prisma as never, {} as never);
    return { service, prisma };
  }

  it("returns the same structured failure the status stream carries, with an English error", async () => {
    const { service, prisma } = serviceWith(null);
    await service.markFailed(42, "We couldn't read report.docx.", failure);
    const stored = (
      prisma.gradingProgress.updateMany.mock.calls[0][0] as {
        data: { error: string };
      }
    ).data.error;

    const { service: reader } = serviceWith({ attemptId: 42, error: stored });
    await expect(reader.getProgress(42)).resolves.toMatchObject({
      error: "We couldn't read report.docx.",
      failure,
    });
  });

  it("leaves plain-text reasons from older rows untouched", async () => {
    const { service } = serviceWith({
      attemptId: 1,
      error: "Grading failed: boom",
    });
    const progress = await service.getProgress(1);
    expect(progress).toEqual({ attemptId: 1, error: "Grading failed: boom" });
  });
});
