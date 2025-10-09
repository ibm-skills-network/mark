import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/prisma.service";
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
import {
  VersionManagementService,
  VersionSummary,
} from "./version-management.service";

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
    private readonly versionManagementService: VersionManagementService,
    private readonly jobStatusService: JobStatusServiceV2,
    private readonly prisma: PrismaService,
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
    this.logger.info(
      `📦 PUBLISH REQUEST: Received updateDto with versionNumber: ${updateDto.versionNumber}, versionDescription: ${updateDto.versionDescription}`,
    );
    const job = await this.jobStatusService.createPublishJob(
      assignmentId,
      userId,
    );

    this.startPublishingProcess(job.id, assignmentId, updateDto, userId).catch(
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
    userId: string,
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
        attemptsBeforeCoolDown: updateDto.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes: updateDto.retakeAttemptCoolDownMinutes,
        passingGrade: updateDto.passingGrade,
        displayOrder: updateDto.displayOrder,
        graded: updateDto.graded,
        questionDisplay: updateDto.questionDisplay,
        allotedTimeMinutes: updateDto.allotedTimeMinutes,
        published: updateDto.published,
        showAssignmentScore: updateDto.showAssignmentScore,
        showQuestionScore: updateDto.showQuestionScore,
        showSubmissionFeedback: updateDto.showSubmissionFeedback,
        correctAnswerVisibility: updateDto.correctAnswerVisibility,
        timeEstimateMinutes: updateDto.timeEstimateMinutes,
        showQuestions: updateDto.showQuestions,
        numberOfQuestionsPerAttempt: updateDto.numberOfQuestionsPerAttempt,
      });

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Assignment settings updated",
        percentage: 10,
      });

      try {
        await this.prisma.assignmentAuthor.upsert({
          where: {
            assignmentId_userId: {
              assignmentId,
              userId,
            },
          },
          update: {},
          create: {
            assignmentId,
            userId,
          },
        });
      } catch (error) {
        // Log but don't fail the publishing process if author tracking fails
        this.logger.warn(
          `Failed to store assignment author: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }

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
        // Only check language consistency if no content changes and we have existing translations
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Checking for language consistency issues",
          percentage: 78,
        });

        // Quick check to see if we have existing translations first
        const hasExistingTranslations =
          await this.prisma.assignmentTranslation.count({
            where: { assignmentId },
          });

        if (hasExistingTranslations > 0) {
          // Use quick validation instead of expensive language detection
          // const isValid = await this.translationService.quickValidateAssignmentTranslations(
          //   assignmentId,
          // );
          const isValid = true;
          if (isValid) {
            await this.jobStatusService.updateJobStatus(jobId, {
              status: "In Progress",
              progress:
                "Translation validation passed, skipping consistency check",
              percentage: 85,
            });
          } else {
            // Only do expensive validation if quick check fails
            this.logger.warn(
              `Quick validation failed for assignment ${assignmentId}, running full validation`,
            );

            const languageValidation =
              await this.translationService.validateAssignmentLanguageConsistency(
                assignmentId,
              );

            if (languageValidation.isConsistent) {
              await this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: "Language consistency validated, no issues found",
                percentage: 85,
              });
            } else {
              this.logger.warn(
                `Language consistency issues detected for assignment ${assignmentId}: ${languageValidation.mismatchedLanguages.join(
                  ", ",
                )}`,
              );

              // Language mismatch detected - force retranslation for affected languages
              await this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: `Language mismatch detected for ${languageValidation.mismatchedLanguages.length} languages, refreshing translations`,
                percentage: 80,
              });

              await this.translationService.retranslateAssignmentForLanguages(
                assignmentId,
                languageValidation.mismatchedLanguages,
                jobId,
              );

              await this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: "Translation refresh completed",
                percentage: 90,
              });
            }
          }
        } else {
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress:
              "No existing translations to validate, skipping consistency check",
            percentage: 85,
          });
        }
      }

      // Final translation validation
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Validating translation completeness",
        percentage: 88,
      });

      const translationCompleteness =
        await this.translationService.ensureTranslationCompleteness(
          assignmentId,
        );

      if (!translationCompleteness.isComplete) {
        this.logger.warn(
          `Missing translations detected for assignment ${assignmentId}. Attempting to fix...`,
          { missingTranslations: translationCompleteness.missingTranslations },
        );

        // Attempt to fix missing translations
        for (const missing of translationCompleteness.missingTranslations) {
          try {
            // Note: We're not fixing missing translations here
            // This is just logging for monitoring
            this.logger.warn(
              `Missing translations for ${
                missing.variantId
                  ? `variant ${missing.variantId}`
                  : `question ${missing.questionId}`
              }: ${missing.missingLanguages.join(", ")}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to fix missing translation for question ${missing.questionId}`,
              error,
            );
          }
        }
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
        published: updateDto.published,
      });

      const updatedQuestions =
        await this.questionService.getQuestionsForAssignment(assignmentId);

      updatedQuestions.sort((a, b) => {
        const indexA = questionOrder.indexOf(a.id);
        const indexB = questionOrder.indexOf(b.id);
        return indexA - indexB;
      });

      // Log the questions that were found after processing
      this.logger.info(
        `Found ${updatedQuestions.length} questions after processing for assignment ${assignmentId}`,
        {
          questionIds: updatedQuestions.map((q) => q.id),
        },
      );

      // Create a new version when publishing - AFTER questions are processed and committed
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Creating version snapshot",
        percentage: 95,
      });

      try {
        this.logger.info(
          `Managing version after question processing - found ${updatedQuestions.length} questions`,
        );

        const userSession = {
          userId,
          role: "AUTHOR",
        } as unknown as UserSession;

        // Check if there's an existing draft version to update/publish
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const existingDraft =
          await this.versionManagementService.getUserLatestDraft(
            assignmentId,
            userSession,
          );

        // Check for recently created unpublished versions (to prevent duplicates from frontend)
        const latestVersion =
          await this.versionManagementService.getLatestVersion(assignmentId);

        let versionResult: VersionSummary;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (
          existingDraft &&
          updateDto.published &&
          existingDraft?._draftVersionId
        ) {
          // If we have a draft and we're publishing, publish the existing draft
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const draftVersionId = existingDraft._draftVersionId;
          this.logger.info(
            `Found existing draft version, publishing it instead of creating new version`,
            { draftVersionId },
          );

          // Update the existing draft with current content first
          await this.versionManagementService.saveDraft(
            assignmentId,
            {
              assignmentData: {
                name: updateDto.name,
                introduction: updateDto.introduction,
                instructions: updateDto.instructions,
                gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
                timeEstimateMinutes: updateDto.timeEstimateMinutes,
              },
              questionsData: updatedQuestions,
              versionDescription:
                updateDto.versionDescription ??
                `Published version - ${new Date().toLocaleDateString()}`,
              versionNumber: updateDto.versionNumber,
            },
            userSession,
          );

          // Then publish the updated draft
          versionResult = await this.versionManagementService.publishVersion(
            assignmentId,
            draftVersionId,
          );
        } else if (
          latestVersion &&
          !latestVersion.published &&
          updateDto.published
        ) {
          // There's a recently created unpublished version - publish it instead of creating new one
          this.logger.info(
            `Found recently created unpublished version ${latestVersion.versionNumber}, publishing it instead of creating duplicate`,
            {
              versionId: latestVersion.id,
              versionNumber: latestVersion.versionNumber,
            },
          );

          versionResult = await this.versionManagementService.publishVersion(
            assignmentId,
            latestVersion.id,
          );
        } else if (!existingDraft && updateDto.published) {
          // No existing draft and no unpublished version - create new version directly
          this.logger.info(
            `No existing draft or unpublished version found, creating new version directly`,
          );
          this.logger.info(
            `UpdateDto contains versionNumber: ${updateDto.versionNumber}, versionDescription: ${updateDto.versionDescription}`,
          );

          versionResult = await this.versionManagementService.createVersion(
            assignmentId,
            {
              versionNumber: updateDto.versionNumber,
              versionDescription:
                updateDto.versionDescription ??
                `Version - ${new Date().toLocaleDateString()}`,
              isDraft: false, // Create as published directly
              shouldActivate: true,
            },
            userSession,
          );
        } else {
          // Create or update draft version (not publishing)
          this.logger.info(`Saving as draft version`);

          versionResult = await this.versionManagementService.saveDraft(
            assignmentId,
            {
              assignmentData: {
                name: updateDto.name,
                introduction: updateDto.introduction,
                instructions: updateDto.instructions,
                gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
                timeEstimateMinutes: updateDto.timeEstimateMinutes,
              },
              questionsData: updatedQuestions,
              versionDescription:
                updateDto.versionDescription ??
                `Draft - ${new Date().toLocaleDateString()}`,
              versionNumber: updateDto.versionNumber,
            },
            userSession,
          );
        }

        this.logger.info(
          `Successfully managed version ${versionResult.id} for assignment ${assignmentId} during publishing with ${versionResult.questionCount} questions`,
          {
            versionNumber: versionResult.versionNumber,
            isDraft: versionResult.isDraft,
            isActive: versionResult.isActive,
            published: versionResult.published,
          },
        );
      } catch (versionError) {
        // Log the full error details
        this.logger.error(
          `Failed to create version during publishing for assignment ${assignmentId}:`,
          {
            error:
              versionError instanceof Error
                ? versionError.message
                : "Unknown error",
            stack:
              versionError instanceof Error ? versionError.stack : undefined,
            assignmentId,
            userId,
            questionsFound: updatedQuestions.length,
          },
        );
      }

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
