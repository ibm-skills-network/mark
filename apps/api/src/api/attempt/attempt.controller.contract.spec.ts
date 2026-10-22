import { BadRequestException } from "@nestjs/common";
import { AttemptControllerV2 } from "./attempt.controller";
import { UserRole } from "../../auth/interfaces/user.session.interface";

describe("learner submission HTTP contract", () => {
  function setup(tier: "inline" | "standard") {
    const attempt = {
      classifyLearnerAttemptTier: jest.fn().mockResolvedValue(tier),
      createGradingJob: jest
        .fn()
        .mockResolvedValue({ gradingJobId: "run", queueName: "mark.attempt" }),
      enqueueGradingJob: jest.fn(),
      updateAssignmentAttempt: jest.fn().mockResolvedValue({ grade: 1 }),
    };
    const killSwitch = { assertGradingAllowed: jest.fn() };
    const logger = { child: jest.fn().mockReturnThis(), info: jest.fn() };
    return {
      attempt,
      killSwitch,
      controller: new AttemptControllerV2(
        logger as never,
        attempt as never,
        {} as never,
        {} as never,
        {} as never,
        killSwitch as never,
      ),
    };
  }
  const request = {
    userSession: { role: UserRole.LEARNER, userId: "learner" },
  };
  it.each(["inline", "standard"] as const)(
    "rejects malformed answers before %s work starts",
    async (tier) => {
      const { attempt, killSwitch, controller } = setup(tier);
      await expect(
        controller.updateAssignmentAttempt(
          1,
          2,
          {
            submitted: true,
            responsesForQuestions: [{ id: 1 }, { id: 1 }],
          } as never,
          request as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(killSwitch.assertGradingAllowed).not.toHaveBeenCalled();
      for (const call of Object.values(attempt))
        expect(call).not.toHaveBeenCalled();
    },
  );
  it.each(["inline", "standard"] as const)(
    "preserves false answers through %s routing",
    async (tier) => {
      const { attempt, controller } = setup(tier);
      const input = {
        submitted: true,
        responsesForQuestions: [{ id: 3, learnerAnswerChoice: false }],
      };
      await controller.updateAssignmentAttempt(
        1,
        2,
        input as never,
        request as never,
      );
      if (tier === "inline")
        expect(attempt.updateAssignmentAttempt).toHaveBeenCalledWith(
          1,
          2,
          input,
          "",
          false,
          request,
        );
      else
        expect(attempt.enqueueGradingJob).toHaveBeenCalledWith(
          "run",
          1,
          2,
          input,
          "",
          request,
          "mark.attempt",
        );
    },
  );
});
