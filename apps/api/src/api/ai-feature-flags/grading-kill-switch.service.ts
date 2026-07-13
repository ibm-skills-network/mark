import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../database/prisma.service";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import {
  AI_GRADED_QUESTION_TYPES,
  AiFeatureComponent,
} from "./ai-feature-flags.constants";
import { AiTemporarilyDisabledException } from "./ai-temporarily-disabled.exception";

/**
 * Gate for the learner attempt lifecycle: blocks starting or submitting an
 * attempt on an AI-graded assignment while grading is switched off.
 *
 * "AI-graded" is derived from question types (see {@link AI_GRADED_QUESTION_TYPES})
 * rather than the `Assignment.type` metadata flag, so a mixed quiz (MCQ + one
 * free-text question) is correctly blocked, while a quiz built only from
 * MCQ / True-False / Multi-Select is never touched.
 */
@Injectable()
export class GradingKillSwitchService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiFlags: AiFeatureFlagsService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: GradingKillSwitchService.name,
    });
  }

  /** Whether the assignment contains at least one LLM-graded question. */
  async assignmentUsesAiGrading(assignmentId: number): Promise<boolean> {
    const aiQuestion = await this.prisma.question.findFirst({
      where: {
        assignmentId,
        type: { in: AI_GRADED_QUESTION_TYPES },
      },
      select: { id: true },
    });
    return aiQuestion !== null;
  }

  /**
   * Throws {@link AiTemporarilyDisabledException} when grading is disabled and
   * the assignment would trigger an LLM grading call. No-op (and no DB query)
   * when grading is enabled, so the normal path is unaffected.
   *
   * @param action used only for logging context ("start" | "submit").
   */
  async assertGradingAllowed(
    assignmentId: number,
    userId: string | undefined,
    action: "start" | "submit",
  ): Promise<void> {
    if (this.aiFlags.isEnabled(AiFeatureComponent.GRADING)) {
      return;
    }

    if (!(await this.assignmentUsesAiGrading(assignmentId))) {
      // Non-AI assignment (e.g. MCQ-only) — unaffected by the grading switch.
      return;
    }

    this.logger.warn("ai.killswitch.grading.blocked", {
      assignmentId,
      userId,
      action,
    });
    throw new AiTemporarilyDisabledException();
  }
}
