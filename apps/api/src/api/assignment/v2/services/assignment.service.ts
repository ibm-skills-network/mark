import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import { ReplaceAssignmentRequestDto } from "../../dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "../../dto/update.assignment.request.dto";
import {
  Choice,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
} from "../../dto/update.questions.request.dto";
import { AssignmentRepository } from "../repositories/assignment.repository";
import { JobStatusServiceV2 } from "./job-status.service";
import { QuestionService } from "./question.service";
import { TranslationService } from "./translation.service";

/**
 * Service for managing assignment operations
 */
@Injectable()
export class AssignmentServiceV2 {
  private logger: Logger;
  constructor(
    private readonly assignmentRepository: AssignmentRepository,
    private readonly questionService: QuestionService,
    private readonly translationService: TranslationService,
    private readonly jobStatusService: JobStatusServiceV2,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "AssignmentServiceV2" });
  }

  /**
   * Get an assignment by ID with possible translation
   *
   * @param assignmentId - The ID of the assignment
   * @param userSession - The user session details
   * @param languageCode - Optional language code for translation
   * @returns Assignment data tailored to the user's role
   */

  async getAssignment(
    assignmentId: number,
    userSession: UserSession,
    languageCode?: string,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const assignment = await this.assignmentRepository.findById(
      assignmentId,
      userSession,
    );

    if (languageCode) {
      await this.translationService.applyTranslationsToAssignment(
        assignment,
        languageCode,
      );
    }

    return assignment;
  }

  /**
   * List all assignments available to the user
   *
   * @param userSession - The user session details
   * @returns Array of assignment summaries
   */

  async listAssignments(
    userSession: UserSession,
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentRepository.findAllForUser(userSession);
  }

  /**
   * Update an assignment with new properties
   *
   * @param id - The assignment ID
   * @param updateDto - The data to update
   * @returns Success response with the updated assignment ID
   */

  async updateAssignment(
    id: number,
    updateDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const existingAssignment = await this.assignmentRepository.findById(id);

    const shouldTranslate = this.shouldTranslateAssignment(
      existingAssignment,
      updateDto,
    );

    const result = await this.assignmentRepository.update(id, updateDto);

    if (shouldTranslate) {
      await this.translationService.translateAssignment(id);
    }

    if (updateDto.published) {
      await this.questionService.updateQuestionGradingContext(id);
    }

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Replace an entire assignment
   *
   * @param id - The assignment ID
   * @param replaceDto - The new assignment data
   * @returns Success response with the updated assignment ID
   */
  async replaceAssignment(
    id: number,
    replaceDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.assignmentRepository.replace(id, replaceDto);

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Get available languages for an assignment
   *
   * @param assignmentId - The assignment ID
   * @returns Array of language codes
   */
  async getAvailableLanguages(assignmentId: number): Promise<string[]> {
    return this.translationService.getAvailableLanguages(assignmentId);
  }

  /**
   * Publish an assignment with updated questions
   *
   * @param assignmentId - The assignment ID
   * @param updateDto - The updated assignment data with questions
   * @param userId - The ID of the user making the request
   * @returns Job tracking information
   */
  async publishAssignment(
    assignmentId: number,
    updateDto: UpdateAssignmentQuestionsDto,
    userId: string,
  ): Promise<{ jobId: number; message: string }> {
    const job = await this.jobStatusService.createPublishJob(
      assignmentId,
      userId,
    );

    this.startPublishingProcess(job.id, assignmentId, updateDto).catch(
      (error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Publishing failed: ${errorMessage}`, errorStack);
        void this.jobStatusService.updateJobStatus(job.id, {
          status: "Failed",
          progress: `Error: ${errorMessage}`,
        });
      },
    );

    return {
      jobId: job.id,
      message: "Publishing started",
    };
  }
  private async startPublishingProcess(
    jobId: number,
    assignmentId: number,
    updateDto: UpdateAssignmentQuestionsDto,
  ): Promise<void> {
    try {
      // Progress allocation:
      // 0-10%: Initial setup
      // 10-30%: Assignment update
      // 30-80%: Questions processing (if needed)
      // 80-90%: Translation (if needed)
      // 90-100%: Finalization

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Updating assignment settings",
        percentage: 5,
      });

      const existingAssignment =
        await this.assignmentRepository.findById(assignmentId);

      const assignmentTranslatableFieldsChanged =
        this.haveTranslatableAssignmentFieldsChanged(
          existingAssignment,
          updateDto,
        );

      await this.assignmentRepository.update(assignmentId, {
        introduction: updateDto.introduction,
        instructions: updateDto.instructions,
        gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
        numAttempts: updateDto.numAttempts,
        passingGrade: updateDto.passingGrade,
        displayOrder: updateDto.displayOrder,
        graded: updateDto.graded,
        questionDisplay: updateDto.questionDisplay,
        allotedTimeMinutes: updateDto.allotedTimeMinutes,
        published: updateDto.published,
        showAssignmentScore: updateDto.showAssignmentScore,
        showQuestionScore: updateDto.showQuestionScore,
        showSubmissionFeedback: updateDto.showSubmissionFeedback,
        timeEstimateMinutes: updateDto.timeEstimateMinutes,
        showQuestions: updateDto.showQuestions,
        numberOfQuestionsPerAttempt: updateDto.numberOfQuestionsPerAttempt,
      });

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Assignment settings updated",
        percentage: 10,
      });

      let questionContentChanged = false;

      if (updateDto.questions && updateDto.questions.length > 0) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Checking for question content changes",
          percentage: 15,
        });

        const existingQuestions =
          await this.questionService.getQuestionsForAssignment(assignmentId);

        questionContentChanged = this.haveQuestionContentsChanged(
          existingQuestions,
          updateDto.questions,
        );

        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: questionContentChanged
            ? `Processing ${updateDto.questions.length} questions with content changes`
            : "Processing questions (metadata only)",
          percentage: 20,
        });

        await this.questionService.processQuestionsForPublishing(
          assignmentId,
          updateDto.questions,
          jobId,
          async (childProgress: number) => {
            const mappedProgress = 30 + (childProgress * 50) / 100;
            await this.jobStatusService.updateJobStatus(jobId, {
              status: "In Progress",
              progress: `Processing questions: ${childProgress}% complete`,
              percentage: Math.floor(mappedProgress),
            });
          },
        );
      }

      if (assignmentTranslatableFieldsChanged || questionContentChanged) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Content changes detected, translating assignment",
          percentage: 80,
        });

        await this.translationService.translateAssignment(assignmentId, jobId, {
          start: 80,
          end: 90,
        });
      } else {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "No content changes detected, skipping translation",
          percentage: 85,
        });
      }

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Finalizing publishing",
        percentage: 90,
      });

      const questionOrder = updateDto.questions?.map((q) => q.id) || [];

      if (questionContentChanged || !existingAssignment.published) {
        await this.questionService.updateQuestionGradingContext(assignmentId);
      }

      await this.assignmentRepository.update(assignmentId, {
        questionOrder,
        published: true,
      });

      const updatedQuestions =
        await this.questionService.getQuestionsForAssignment(assignmentId);

      updatedQuestions.sort((a, b) => {
        const indexA = questionOrder.indexOf(a.id);
        const indexB = questionOrder.indexOf(b.id);
        return indexA - indexB;
      });

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress:
          assignmentTranslatableFieldsChanged || questionContentChanged
            ? "Publishing completed successfully with content updates!"
            : "Publishing completed successfully (configuration updates only)",
        percentage: 100,
        result: updatedQuestions,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Publishing process failed: ${errorMessage}`,
        errorStack,
      );
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Failed",
        progress: `Error: ${errorMessage}`,
      });
      throw error;
    }
  }

  private safeStringCompare = (
    string1: string | null | undefined,
    string2: string | null | undefined,
  ): boolean => {
    const normalizedString1 =
      string1 === null || string1 === undefined ? "" : String(string1);
    const normalizedString2 =
      string2 === null || string2 === undefined ? "" : String(string2);
    return normalizedString1 === normalizedString2;
  };

  /**
   * Check if translatable assignment fields have changed
   */
  private haveTranslatableAssignmentFieldsChanged(
    existingAssignment:
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto,
    updateDto: UpdateAssignmentRequestDto | UpdateAssignmentQuestionsDto,
  ): boolean {
    if (existingAssignment.graded !== updateDto.graded) {
      this.logger.debug(
        "Graded status changed, but this doesn't trigger translation",
      );
    }

    const nameChanged =
      updateDto.name !== undefined &&
      updateDto.name !== null &&
      !this.safeStringCompare(existingAssignment.name, updateDto.name);

    const instructionsChanged =
      updateDto.instructions !== undefined &&
      updateDto.instructions !== null &&
      !this.safeStringCompare(
        existingAssignment.instructions,
        updateDto.instructions,
      );

    const introductionChanged =
      updateDto.introduction !== undefined &&
      updateDto.introduction !== null &&
      !this.safeStringCompare(
        existingAssignment.introduction,
        updateDto.introduction,
      );

    const gradingCriteriaChanged =
      updateDto.gradingCriteriaOverview !== undefined &&
      updateDto.gradingCriteriaOverview !== null &&
      !this.safeStringCompare(
        existingAssignment.gradingCriteriaOverview,
        updateDto.gradingCriteriaOverview,
      );
    if (
      nameChanged ||
      instructionsChanged ||
      introductionChanged ||
      gradingCriteriaChanged
    ) {
      this.logger.debug(`Translatable fields changed: 
      name: ${String(nameChanged)}, 
      instructions: ${String(instructionsChanged)}, 
      introduction: ${String(introductionChanged)}, 
      gradingCriteria: ${String(gradingCriteriaChanged)}
    `);
    } else {
      this.logger.debug("No translatable fields changed");
    }

    return (
      nameChanged ||
      instructionsChanged ||
      introductionChanged ||
      gradingCriteriaChanged
    );
  }
  /**
   * Enhanced method to check if question content has changed with detailed logging
   */
  private haveQuestionContentsChanged(
    existingQuestions: QuestionDto[],
    updatedQuestions: QuestionDto[],
  ): boolean {
    if (existingQuestions.length !== updatedQuestions.length) {
      this.logger.debug(
        `Question count changed: ${existingQuestions.length} → ${updatedQuestions.length}`,
      );
      return true;
    }

    this.logger.debug(
      `Comparing ${existingQuestions.length} questions for content changes`,
    );

    const existingQuestionsMap = new Map<number, QuestionDto>();
    for (const question of existingQuestions) {
      existingQuestionsMap.set(question.id, question);
    }

    for (const updatedQuestion of updatedQuestions) {
      const existingQuestion = existingQuestionsMap.get(updatedQuestion.id);

      if (!existingQuestion) {
        this.logger.debug(`New question detected: ID ${updatedQuestion.id}`);
        return true;
      }

      this.logger.debug(`Comparing question #${updatedQuestion.id}:
      Text: "${existingQuestion.question}" → "${updatedQuestion.question}"
      Type: "${existingQuestion.type}" → "${updatedQuestion.type}"
      Total Points: ${existingQuestion.totalPoints} → ${
        updatedQuestion.totalPoints
      }
      Choices Count: ${existingQuestion.choices?.length || 0} → ${
        updatedQuestion.choices?.length || 0
      }
      Variants Count: ${existingQuestion.variants?.length || 0} → ${
        updatedQuestion.variants?.length || 0
      }
    `);

      if (
        !this.safeStringCompare(
          updatedQuestion.question,
          existingQuestion.question,
        )
      ) {
        this.logger.debug(`Question #${updatedQuestion.id} text changed`);
        return true;
      }

      if (updatedQuestion.type !== existingQuestion.type) {
        this.logger.debug(
          `Question #${updatedQuestion.id} type changed: ${existingQuestion.type} → ${updatedQuestion.type}`,
        );
        return true;
      }

      const choicesEqual = this.areChoicesEqual(
        updatedQuestion.choices,
        existingQuestion.choices,
      );
      if (!choicesEqual) {
        this.logger.debug(`Question #${updatedQuestion.id} choices changed`);
        return true;
      }

      const variantsChanged = this.haveVariantsChanged(
        existingQuestion.variants,
        updatedQuestion.variants,
        updatedQuestion.id,
      );

      if (variantsChanged) {
        this.logger.debug(`Question #${updatedQuestion.id} variants changed`);
        return true;
      }

      if (updatedQuestion.totalPoints !== existingQuestion.totalPoints) {
        this.logger.debug(
          `Question #${updatedQuestion.id} points changed: ${existingQuestion.totalPoints} → ${updatedQuestion.totalPoints} (non-translatable)`,
        );
      }

      if (updatedQuestion.maxWords !== existingQuestion.maxWords) {
        this.logger.debug(
          `Question #${updatedQuestion.id} maxWords changed: ${existingQuestion.maxWords} → ${updatedQuestion.maxWords} (non-translatable)`,
        );
      }
    }

    this.logger.debug(`No content changes detected in any questions`);
    return false;
  }

  /**
   * Enhanced method to check if variants have changed with optional question ID for logging
   */
  private haveVariantsChanged(
    variants1?: VariantDto[],
    variants2?: VariantDto[],
    questionId?: number,
  ): boolean {
    const logPrefix = questionId
      ? `Question #${questionId} variants: `
      : "Variants: ";

    if (!variants1 && !variants2) {
      this.logger.debug(
        `${logPrefix}Both variant arrays are null/undefined (no change)`,
      );
      return false;
    }

    if (!variants1 || !variants2) {
      this.logger.debug(
        `${logPrefix}One variant array is null/undefined (change detected)`,
      );
      return true;
    }

    if (variants1.length !== variants2.length) {
      this.logger.debug(
        `${logPrefix}Variant count changed: ${variants1.length} → ${variants2.length}`,
      );
      return true;
    }

    if (variants1.length === 0) {
      this.logger.debug(
        `${logPrefix}Both variant arrays are empty (no change)`,
      );
      return false;
    }

    this.logger.debug(`${logPrefix}Comparing ${variants1.length} variants`);

    const sortedVariants1 = [...variants1].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    const sortedVariants2 = [...variants2].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );

    for (const [index, v1] of sortedVariants1.entries()) {
      const v2 = sortedVariants2[index];

      this.logger.debug(`${logPrefix}Comparing variant #${index + 1}:
      Content: "${v1.variantContent.slice(
        0,
        30,
      )}..." → "${v2.variantContent.slice(0, 30)}..."
      Choices Count: ${v1.choices?.length || 0} → ${v2.choices?.length || 0}
    `);

      if (!this.safeStringCompare(v1.variantContent, v2.variantContent)) {
        this.logger.debug(`${logPrefix}Variant #${index + 1} content changed`);
        return true;
      }

      if (!this.areChoicesEqual(v1.choices, v2.choices)) {
        this.logger.debug(`${logPrefix}Variant #${index + 1} choices changed`);
        return true;
      }
    }

    this.logger.debug(`${logPrefix}No changes detected in variants`);
    return false;
  }

  /**
   * Corrected method to check if choices have changed
   * Returns TRUE if they are equal (no change), FALSE if they're different
   */
  private areChoicesEqual(choices1?: Choice[], choices2?: Choice[]): boolean {
    if (!choices1 && !choices2) return true;
    if (!choices1 || !choices2) return false;
    if (choices1.length !== choices2.length) return false;
    const sortedChoices1 = [...choices1].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    const sortedChoices2 = [...choices2].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    for (const [index, c1] of sortedChoices1.entries()) {
      const c2 = sortedChoices2[index];
      if (
        (c1.choice !== undefined &&
          !this.safeStringCompare(c1.choice, c2.choice)) ||
        !this.safeStringCompare(c1.feedback, c2.feedback) ||
        (c1.isCorrect !== undefined && c1.isCorrect !== c2.isCorrect)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Determine if an assignment needs translation after updates
   *
   * @param existingAssignment - The current assignment data
   * @param updateDto - The updated assignment data
   * @returns Boolean indicating if translation is needed
   */
  private shouldTranslateAssignment(
    existingAssignment:
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto,
    updateDto: UpdateAssignmentRequestDto,
  ): boolean {
    return (
      (updateDto.name && updateDto.name !== existingAssignment.name) ||
      (updateDto.instructions &&
        updateDto.instructions !== existingAssignment.instructions) ||
      (updateDto.introduction &&
        updateDto.introduction !== existingAssignment.introduction) ||
      (updateDto.gradingCriteriaOverview &&
        updateDto.gradingCriteriaOverview !==
          existingAssignment.gradingCriteriaOverview)
    );
  }
}
