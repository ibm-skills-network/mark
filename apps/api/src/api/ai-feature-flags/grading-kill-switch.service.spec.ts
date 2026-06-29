import { AiFeatureComponent } from "./ai-feature-flags.constants";
import { AiTemporarilyDisabledException } from "./ai-temporarily-disabled.exception";
import { GradingKillSwitchService } from "./grading-kill-switch.service";

const makeLogger = () =>
  ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }) as any;

const makeFlags = (gradingEnabled: boolean) =>
  ({
    isEnabled: (component: AiFeatureComponent) =>
      component === AiFeatureComponent.GRADING ? gradingEnabled : true,
  }) as any;

describe("GradingKillSwitchService.assertGradingAllowed", () => {
  it("is a no-op (and runs no DB query) when grading is enabled", async () => {
    const prisma = { question: { findFirst: jest.fn() } } as any;
    const service = new GradingKillSwitchService(
      prisma,
      makeFlags(true),
      makeLogger(),
    );

    await expect(
      service.assertGradingAllowed(1, "user@example.com", "start"),
    ).resolves.toBeUndefined();
    expect(prisma.question.findFirst).not.toHaveBeenCalled();
  });

  it("blocks an AI-graded assignment when grading is disabled", async () => {
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
    } as any;
    const service = new GradingKillSwitchService(
      prisma,
      makeFlags(false),
      makeLogger(),
    );

    await expect(
      service.assertGradingAllowed(1, "user@example.com", "submit"),
    ).rejects.toBeInstanceOf(AiTemporarilyDisabledException);
  });

  it("allows an MCQ-only assignment even when grading is disabled (sales-team guarantee)", async () => {
    // No AI-graded question exists for this assignment.
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const service = new GradingKillSwitchService(
      prisma,
      makeFlags(false),
      makeLogger(),
    );

    await expect(
      service.assertGradingAllowed(1, "sales@example.com", "start"),
    ).resolves.toBeUndefined();
    expect(prisma.question.findFirst).toHaveBeenCalledTimes(1);
  });
});
