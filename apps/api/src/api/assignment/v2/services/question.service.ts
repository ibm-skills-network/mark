import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import {
  AssignmentFileExtractionStatus,
  AssignmentFileStatus,
  Prisma,
  ResponseType,
} from "@prisma/client";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
import { JobQueueService } from "src/job-queue/job-queue.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  EnhancedQuestionsToGenerate,
  QuestionGenerationPayload,
} from "../../dto/post.assignment.request.dto";
import {
  Choice,
  GenerateQuestionVariantDto,
  QuestionDto,
  VariantDto,
  VariantType,
} from "../../dto/update.questions.request.dto";
import { applyQuestionOrder } from "../../utils/question-order.util";
import { assertQuestionCountsWithinCaps } from "../../utils/questions-to-generate-caps.util";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";
import { JobStatusServiceV2 } from "./job-status.service";
import { TranslationService } from "./translation.service";

@Injectable()
export class QuestionService {
  private readonly logger = new Logger(QuestionService.name);
  private questionCache = new Map<number, QuestionDto[]>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionRepository: QuestionRepository,
    private readonly variantRepository: VariantRepository,
    private readonly translationService: TranslationService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV2,
    private readonly jobQueueService: JobQueueService,
  ) {}

  async getQuestionsForAssignment(
    assignmentId: number,
    useCache = false,
  ): Promise<QuestionDto[]> {
    if (useCache && this.questionCache.has(assignmentId)) {
      const cachedQuestions = this.questionCache.get(assignmentId);
      if (cachedQuestions) return cachedQuestions;
      return [];
    }

    const questions =
      await this.questionRepository.findByAssignmentId(assignmentId);
    this.questionCache.set(assignmentId, questions);
    return questions;
  }

  async generateQuestionVariants(
    assignmentId: number,
    generateVariantDto: GenerateQuestionVariantDto,
  ): Promise<BaseAssignmentResponseDto & { questions?: QuestionDto[] }> {
    const { questions, questionVariationNumber } = generateVariantDto;

    await Promise.all(
      questions.map(async (question) => {
        if (question.variants === undefined) {
          question.variants = [];
        }

        const requiredVariants = this.calculateRequiredVariants(
          questions.length,
          question.variants.length,
          questionVariationNumber,
        );

        if (requiredVariants <= 0) return;

        const newVariants = await this.generateVariantsFromQuestion(
          question,
          requiredVariants,
        );

        this.addVariantsToQuestion(question, newVariants);
      }),
    );

    return {
      id: assignmentId,
      success: true,
      questions,
    };
  }

  /**
   * Process questions for publishing with detailed progress tracking. This is
   * where the main logic for saving and updating questions on a publish lives.
   *
   * Hardening rules in this flow:
   *  - Caller-supplied ids are NEVER trusted as primary keys for new rows. New
   *    rows go through `createForAssignment`, which lets the database allocate
   *    the id.
   *  - Updates only succeed when the row already belongs to this assignment.
   *    `updateOwnedById` enforces the ownership check; on miss we fall through
   *    to a create so a stale/hostile frontend cannot mutate foreign rows.
   *  - Deletions are computed against the set of payload entries that the
   *    server actually recognized as existing rows for this assignment, not
   *    against arbitrary client-supplied ids.
   *  - Payloads with two entries that both claim to be the SAME existing row
   *    are rejected with a generic 400.
   *  - After the loop, the persisted count is asserted against the incoming
   *    count; a mismatch is loudly logged and thrown so the worker fails.
   *
   * @param assignmentId - The assignment ID
   * @param questions - Array of questions to process
   * @param jobId - Optional job ID for progress tracking
   */
  async processQuestionsForPublishing(
    assignmentId: number,
    questions: QuestionDto[],
    jobId?: string,
    progressCallback?: (progress: number) => Promise<void>,
    forceTranslation = false,
  ): Promise<Map<number, number>> {
    void forceTranslation;
    const INITIAL_SETUP_RANGE = { start: 0, end: 10 };
    const QUESTION_PROCESSING_RANGE = { start: 10, end: 90 };
    const FINAL_CLEANUP_RANGE = { start: 90, end: 100 };

    const startedAt = Date.now();
    let currentProgress = INITIAL_SETUP_RANGE.start;

    const updateProgress = async (percentage: number, message: string) => {
      currentProgress = Math.max(currentProgress, Math.min(percentage, 100));

      if (progressCallback) {
        await progressCallback(Math.floor(currentProgress));
      } else if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: message,
          percentage: Math.floor(currentProgress),
        });
      }
    };

    try {
      this.logger.log(
        `publish.questions.start { assignmentId: ${assignmentId}, incomingCount: ${questions.length}, jobId: ${jobId ?? "none"} }`,
      );

      // Pre-flight: reject payloads where two entries both claim to be the
      // same already-in-backend row. Generic 400 — no field-name leak.
      const seenAlreadyInBackend = new Set<number>();
      const duplicateIds: number[] = [];
      for (const q of questions) {
        if (q.alreadyInBackend === true) {
          if (seenAlreadyInBackend.has(q.id)) {
            duplicateIds.push(q.id);
          } else {
            seenAlreadyInBackend.add(q.id);
          }
        }
      }
      if (duplicateIds.length > 0) {
        this.logger.warn(
          `publish.questions.duplicate-ids { assignmentId: ${assignmentId}, duplicateIds: [${duplicateIds.join(",")}] }`,
        );
        throw new BadRequestException("Invalid question payload");
      }

      await updateProgress(
        INITIAL_SETUP_RANGE.start,
        "Retrieving existing questions",
      );

      const existingQuestions =
        await this.questionRepository.findByAssignmentId(assignmentId);
      const existingById = new Map<number, QuestionDto>();
      for (const q of existingQuestions) {
        existingById.set(q.id, q);
      }

      await updateProgress(5, "Analyzing question changes");

      const frontendToBackendIdMap = new Map<number, number>();

      // Compute deletions from a SAFE basis: an existing row is deleted unless
      // some payload entry with `alreadyInBackend: true` claims it AND the row
      // belongs to this assignment. Random client ids cannot mark a real row
      // for deletion or preservation.
      const claimedExistingIds = new Set<number>();
      for (const q of questions) {
        if (q.alreadyInBackend === true && existingById.has(q.id)) {
          claimedExistingIds.add(q.id);
        }
      }
      const questionsToDelete = existingQuestions.filter(
        (q) => !claimedExistingIds.has(q.id),
      );

      if (questionsToDelete.length > 0) {
        await updateProgress(
          8,
          `Removing ${questionsToDelete.length} deleted questions`,
        );

        await this.questionRepository.markAsDeleted(
          questionsToDelete.map((q) => q.id),
        );
      }

      await updateProgress(
        INITIAL_SETUP_RANGE.end,
        "Setup completed, processing questions",
      );

      const totalQuestions = questions.length;
      const progressPerQuestion =
        totalQuestions > 0
          ? (QUESTION_PROCESSING_RANGE.end - QUESTION_PROCESSING_RANGE.start) /
            totalQuestions
          : 0;

      let ownershipMismatches = 0;

      for (const [index, questionDto] of questions.entries()) {
        const questionStartProgress =
          QUESTION_PROCESSING_RANGE.start + index * progressPerQuestion;
        const questionEndProgress = questionStartProgress + progressPerQuestion;

        await updateProgress(
          questionStartProgress + progressPerQuestion * 0.1,
          `Processing question ${index + 1} of ${totalQuestions}`,
        );

        const wantsUpdate =
          questionDto.alreadyInBackend === true &&
          existingById.has(questionDto.id);
        const existingQuestion = wantsUpdate
          ? existingById.get(questionDto.id)
          : undefined;

        if (
          existingQuestion &&
          existingQuestion.question !== questionDto.question
        ) {
          await updateProgress(
            questionStartProgress + progressPerQuestion * 0.2,
            `Validating question ${index + 1} content`,
          );

          await this.applyGuardRails(questionDto);
        }

        await updateProgress(
          questionStartProgress + progressPerQuestion * 0.3,
          `Updating question ${index + 1} in database`,
        );

        const updateData = this.buildQuestionUpdateData(questionDto);

        const createInput: Omit<QuestionDto, "id"> = {
          assignmentId,
          question: questionDto.question,
          type: questionDto.type,
          answer: questionDto.answer ?? false,
          totalPoints: questionDto.totalPoints ?? 0,
          authorComment: questionDto.authorComment ?? null,
          choices: questionDto.choices,
          scoring: questionDto.scoring,
          maxWords: questionDto.maxWords,
          maxCharacters: questionDto.maxCharacters,
          responseType: questionDto.responseType,
          randomizedChoices: questionDto.randomizedChoices,
          liveRecordingConfig: questionDto.liveRecordingConfig,
          videoPresentationConfig: questionDto.videoPresentationConfig,
          gradingContextQuestionIds: questionDto.gradingContextQuestionIds,
          isDeleted: false,
        };

        let persistedId: number;
        if (wantsUpdate) {
          const updated = await this.questionRepository.updateOwnedById(
            questionDto.id,
            assignmentId,
            updateData,
          );

          if (updated) {
            persistedId = updated.id;
            this.logger.debug(
              `publish.questions.route { assignmentId: ${assignmentId}, decision: "update", id: ${persistedId} }`,
            );
          } else {
            // Ownership miss — stale frontend or hostile payload. Fall through
            // to create. Same outcome the user expects (their content lands
            // under the target assignment) without ever touching a foreign row.
            ownershipMismatches += 1;
            this.logger.warn(
              `publish.questions.ownership-miss { assignmentId: ${assignmentId}, attemptedId: ${questionDto.id} }`,
            );
            const created = await this.questionRepository.createForAssignment(
              createInput,
              assignmentId,
            );
            persistedId = created.id;
            frontendToBackendIdMap.set(questionDto.id, persistedId);
            this.logger.debug(
              `publish.questions.route { assignmentId: ${assignmentId}, decision: "ownership-miss-fallback-create", id: ${persistedId} }`,
            );
          }
        } else {
          const created = await this.questionRepository.createForAssignment(
            createInput,
            assignmentId,
          );
          persistedId = created.id;
          frontendToBackendIdMap.set(questionDto.id, persistedId);
          this.logger.debug(
            `publish.questions.route { assignmentId: ${assignmentId}, decision: "create", id: ${persistedId} }`,
          );
        }

        await updateProgress(
          questionStartProgress + progressPerQuestion * 0.5,
          `Translating question ${index + 1}`,
        );

        await this.translationService.translateQuestion(
          assignmentId,
          persistedId,
          questionDto,
          jobId,
          true,
        );

        const variantCount = questionDto.variants?.length || 0;
        if (variantCount > 0) {
          await updateProgress(
            questionStartProgress + progressPerQuestion * 0.8,
            `Processing ${variantCount} variants for question ${index + 1}`,
          );

          await this.processVariantsForQuestion(
            assignmentId,
            persistedId,
            questionDto.variants || [],
            existingQuestion?.variants || [],
            jobId,
            true,
          );
        }

        await updateProgress(
          questionEndProgress,
          `Question ${index + 1} completed`,
        );
      }

      await updateProgress(
        FINAL_CLEANUP_RANGE.start,
        "Finalizing question processing",
      );

      // Post-flight invariant: persisted count must equal incoming count.
      const persistedRows =
        await this.questionRepository.findByAssignmentId(assignmentId);
      const persistedCount = persistedRows.length;
      const durationMs = Date.now() - startedAt;

      if (persistedCount !== questions.length) {
        this.logger.error(
          `publish.questions.count-mismatch { assignmentId: ${assignmentId}, expected: ${questions.length}, actual: ${persistedCount}, ownershipMismatches: ${ownershipMismatches} }`,
        );
        throw new Error(
          `Publish count mismatch for assignment ${assignmentId}: expected ${questions.length}, got ${persistedCount}`,
        );
      }

      this.logger.log(
        `publish.questions.done { assignmentId: ${assignmentId}, incomingCount: ${questions.length}, persistedCount: ${persistedCount}, ownershipMismatches: ${ownershipMismatches}, durationMs: ${durationMs} }`,
      );

      await updateProgress(
        FINAL_CLEANUP_RANGE.end,
        "Question processing completed successfully",
      );

      return frontendToBackendIdMap;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (jobId && !progressCallback) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Failed",
          progress: `Question processing failed: ${errorMessage}`,
          percentage: Math.floor(currentProgress),
        });
      }

      throw error;
    }
  }

  /**
   * Check if choices are equal
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
        c1.choice !== c2.choice ||
        c1.feedback !== c2.feedback ||
        c1.isCorrect !== c2.isCorrect
      ) {
        return false;
      }
    }
    return true;
  }

  private checkVariantsForChanges(
    existingVariants: VariantDto[] = [],
    newVariants: VariantDto[] = [],
  ): boolean {
    if (existingVariants.length !== newVariants.length) {
      return true;
    }

    const existingVariantsById = new Map(
      existingVariants.map((variant) => [variant.id, variant]),
    );

    return newVariants.some((newVariant) => {
      const existingVariant = existingVariantsById.get(newVariant.id);

      if (!existingVariant) {
        return true;
      }

      return this.hasVariantChanged(existingVariant, newVariant);
    });
  }

  private hasVariantChanged(
    existingVariant: VariantDto,
    newVariant: VariantDto,
  ): boolean {
    return (
      existingVariant.variantContent !== newVariant.variantContent ||
      existingVariant.variantType !== newVariant.variantType ||
      existingVariant.randomizedChoices !== newVariant.randomizedChoices ||
      existingVariant.maxWords !== newVariant.maxWords ||
      existingVariant.maxCharacters !== newVariant.maxCharacters ||
      existingVariant.isDeleted !== newVariant.isDeleted ||
      !this.areChoicesEqual(existingVariant.choices, newVariant.choices) ||
      !isDeepStrictEqual(existingVariant.scoring, newVariant.scoring)
    );
  }

  async generateQuestions(
    assignmentId: number,
    payload: QuestionGenerationPayload,
    userId: string,
  ): Promise<{ message: string; jobId: string }> {
    this.validateQuestionGenerationPayload(payload);
    const files = await this.resolveQuestionGenerationFiles(
      assignmentId,
      payload,
    );

    const job = await this.jobStatusService.createJob(assignmentId, userId);
    try {
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
        {
          assignmentId,
          assignmentType: payload.assignmentType,
          fileContents: files,
          jobId: job.id,
          learningObjectives: payload.learningObjectives,
          questionsToGenerate: payload.questionsToGenerate,
        },
        {
          jobId: job.id,
        },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.jobStatusService.updateJobStatus(
        job.id,
        {
          status: "Failed",
          progress: `Failed to enqueue question generation job: ${errorMessage}`,
        },
        false,
      );
      throw error;
    }

    return { message: "Question generation started", jobId: job.id };
  }

  async updateQuestionGradingContext(assignmentId: number): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found`,
      );
    }

    const sortedQuestions = applyQuestionOrder(
      assignment.questions,
      assignment.questionOrder,
    );

    const questionsForGradingContext = sortedQuestions.map((q) => ({
      id: q.id,
      questionText: q.question,
    }));

    const gradingContextMap =
      await this.llmFacadeService.generateQuestionGradingContext(
        questionsForGradingContext,
        assignmentId,
      );

    const updates = Object.entries(gradingContextMap).map(
      ([questionId, contextIds]) =>
        this.prisma.question.update({
          where: { id: Number(questionId) },
          data: { gradingContextQuestionIds: contextIds },
        }),
    );

    await Promise.all(updates);
  }
  async runQuestionGenerationJob(
    assignmentId: number,
    jobId: string,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    try {
      let content = "";

      if (files && files.length > 0) {
        await this.jobStatusService.updateJobStatus(
          jobId,
          {
            status: "In Progress",
            progress: "Mark is organizing the notes merging file contents.",
          },
          false,
        );

        content = files.map((file) => file.content).join("\n");

        await this.jobStatusService.updateJobStatus(
          jobId,
          {
            status: "In Progress",
            progress: "Mark is proofreading the content sanitizing material.",
          },
          false,
        );

        content = this.llmFacadeService.sanitizeContent(content);
      }

      await this.jobStatusService.updateJobStatus(
        jobId,
        {
          status: "In Progress",
          progress: "Mark is brainstorming some questions.",
        },
        false,
      );

      const llmResponse = await this.llmFacadeService.processMergedContent(
        assignmentId,
        assignmentType,
        questionsToGenerate,
        content,
        learningObjectives,
      );

      await this.jobStatusService.updateJobStatus(
        jobId,
        {
          status: "Completed",
          progress:
            "Mark has prepared the questions. Job completed successfully.",
          result: llmResponse,
        },
        false,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error processing job ID ${jobId}: ${errorMessage}`,
        errorStack,
      );

      await this.jobStatusService.updateJobStatus(
        jobId,
        {
          status: "Failed",
          progress: "Mark hit a snag, we are sorry for the inconvenience",
        },
        false,
      );
    }
  }

  private validateQuestionGenerationPayload(
    payload: QuestionGenerationPayload,
  ): void {
    const {
      contentSource,
      fileContents,
      learningObjectives,
      questionsToGenerate,
      assignmentId,
    } = payload;

    const requiresUploadedContent =
      contentSource === undefined ||
      contentSource === "payload" ||
      contentSource === "both";

    if (
      requiresUploadedContent &&
      (!fileContents || fileContents.length === 0) &&
      !learningObjectives
    ) {
      throw new BadRequestException(
        "Either file contents or learning objectives are required",
      );
    }

    if (
      contentSource === "both" &&
      (!fileContents || fileContents.length === 0)
    ) {
      throw new BadRequestException(
        "File contents are required when contentSource is both",
      );
    }

    if (Number.isNaN(assignmentId)) {
      throw new BadRequestException("Invalid assignment ID");
    }

    assertQuestionCountsWithinCaps(questionsToGenerate);

    const {
      linkFile,
      multipleChoice,
      multipleChoiceSubtypes,
      multipleSelect,
      responseTypes,
      textResponse,
      trueFalse,
      upload,
      url,
    } = questionsToGenerate;

    const subtypeTotal = multipleChoiceSubtypes
      ? (multipleChoiceSubtypes.short || 0) +
        (multipleChoiceSubtypes.quantitative || 0) +
        (multipleChoiceSubtypes.long || 0) +
        (multipleChoiceSubtypes.scenario || 0)
      : 0;

    if (multipleChoiceSubtypes !== undefined && subtypeTotal === 0) {
      throw new BadRequestException(
        "When multipleChoiceSubtypes is provided, at least one subtype count must be greater than 0",
      );
    }

    const totalQuestions =
      (multipleChoice || 0) +
      (multipleSelect || 0) +
      (textResponse || 0) +
      (trueFalse || 0) +
      (url || 0) +
      (upload || 0) +
      (linkFile || 0) +
      subtypeTotal;

    if (totalQuestions <= 0) {
      throw new BadRequestException(
        "At least one question type must be selected with a count greater than 0",
      );
    }

    if ((url > 0 || upload > 0 || linkFile > 0) && !responseTypes) {
      questionsToGenerate.responseTypes = {
        TEXT: [ResponseType.OTHER],
        URL: [ResponseType.OTHER],
        UPLOAD: [ResponseType.OTHER],
        LINK_FILE: [ResponseType.OTHER],
      };
    }
  }

  private async resolveQuestionGenerationFiles(
    assignmentId: number,
    payload: QuestionGenerationPayload,
  ): Promise<Array<{ filename: string; content: string }> | undefined> {
    const contentSource = payload.contentSource ?? "payload";
    const uploadedFiles = payload.fileContents ?? [];

    if (contentSource === "payload") {
      return uploadedFiles;
    }

    const assignmentFiles = await this.prisma.assignmentFile.findMany({
      where: {
        assignmentId,
        status: AssignmentFileStatus.READY,
        extractionStatus: AssignmentFileExtractionStatus.READY,
        extractedText: { not: null },
      },
      select: {
        filename: true,
        extractedText: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const normalizedAssignmentFiles = assignmentFiles
      .filter(
        (
          file,
        ): file is {
          filename: string;
          extractedText: string;
        } => Boolean(file.extractedText),
      )
      .map((file) => ({
        filename: file.filename,
        content: file.extractedText,
      }));

    if (contentSource === "stored") {
      if (normalizedAssignmentFiles.length === 0) {
        throw new BadRequestException(
          "No extracted assignment files are available for question generation",
        );
      }

      return normalizedAssignmentFiles;
    }

    const combinedFiles = [...uploadedFiles, ...normalizedAssignmentFiles];

    if (combinedFiles.length === 0) {
      throw new BadRequestException(
        "No uploaded or assignment file contents are available for question generation",
      );
    }

    return combinedFiles;
  }

  /**
   * Process variants for a question with conditional translation
   *
   * @param assignmentId - The assignment ID
   * @param questionId - The question ID
   * @param variants - The array of variants to process
   * @param existingVariants - Existing variants for comparison
   * @param jobId - Optional job ID for progress tracking
   * @param forceTranslation - Force translation even if content hasn't changed
   */
  private async processVariantsForQuestion(
    assignmentId: number,
    questionId: number,
    variants: VariantDto[],
    existingVariants: VariantDto[],
    jobId?: string,
    forceTranslation = false,
  ): Promise<void> {
    const existingVariantsMap = new Map<string, VariantDto>();
    const existingVariantsIdMap = new Map<number, VariantDto>();

    for (const v of existingVariants) {
      existingVariantsMap.set(v.variantContent, v);
      existingVariantsIdMap.set(v.id, v);
    }

    const newVariantContents = new Set(variants.map((v) => v.variantContent));
    const variantsToDelete = existingVariants.filter(
      (v) => !newVariantContents.has(v.variantContent),
    );

    if (variantsToDelete.length > 0 && jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Removing ${variantsToDelete.length} variants for question #${questionId}`,
      });

      await this.variantRepository.markAsDeleted(
        variantsToDelete.map((v) => v.id),
      );
    }

    const totalVariants = variants.length;

    for (const [index, variantDto] of variants.entries()) {
      const existingVariant =
        existingVariantsMap.get(variantDto.variantContent) ||
        existingVariantsIdMap.get(variantDto.id);

      const contentChanged =
        forceTranslation ||
        !existingVariant ||
        existingVariant.variantContent !== variantDto.variantContent ||
        !this.areChoicesEqual(existingVariant.choices, variantDto.choices);

      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: contentChanged
            ? `Processing variant ${
                index + 1
              }/${totalVariants} for question #${questionId} - content changes detected`
            : `Processing variant ${
                index + 1
              }/${totalVariants} for question #${questionId} - metadata only`,
        });
      }

      const variantData = {
        variantContent: variantDto.variantContent,
        choices: variantDto.choices,
        scoring: variantDto.scoring,
        maxWords: variantDto.maxWords,
        maxCharacters: variantDto.maxCharacters,
        randomizedChoices: variantDto.randomizedChoices,
        variantType: variantDto.variantType,
        questionId: questionId,
        id: variantDto.id,
      };

      if (existingVariant) {
        const updatedVariant = await this.variantRepository.update(
          existingVariant.id,
          variantData,
        );

        if (jobId) {
          await (contentChanged
            ? this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: `Translating variant ${
                  index + 1
                }/${totalVariants} for question #${questionId} (content changed)`,
              })
            : this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: `Ensuring translations for variant ${
                  index + 1
                }/${totalVariants} for question #${questionId}`,
              }));
        }

        await this.translationService.translateVariant(
          assignmentId,
          questionId,
          updatedVariant.id,
          updatedVariant as unknown as VariantDto,
          jobId,
          true,
        );
      } else {
        const newVariant = await this.variantRepository.create(variantData);

        if (jobId) {
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Translating new variant ${
              index + 1
            }/${totalVariants} for question #${questionId}`,
          });
        }

        await this.translationService.translateVariant(
          assignmentId,
          questionId,
          newVariant.id,
          newVariant as unknown as VariantDto,
          jobId,
          true,
        );
      }
    }
  }

  private async generateVariantsFromQuestion(
    question: QuestionDto,
    numberOfVariants: number,
  ): Promise<VariantDto[]> {
    try {
      if (!question) {
        throw new BadRequestException("Question not provided");
      }

      const variants = await this.llmFacadeService.generateQuestionRewordings(
        question.question,
        numberOfVariants,
        question.type,
        question.assignmentId,
        question.choices,
        question.variants,
      );

      return variants.map((variant) => ({
        id: variant.id,
        questionId: question.id,
        variantContent: variant.variantContent,
        choices: variant.choices,
        maxWords: question.maxWords,
        scoring: question.scoring,
        answer: question.answer,
        maxCharacters: question.maxCharacters,
        createdAt: new Date(),
        variantType: VariantType.REWORDED,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error generating variants: ${errorMessage}`,
        errorStack,
      );
      throw new BadRequestException("Failed to generate question variants");
    }
  }

  private addVariantsToQuestion(
    question: QuestionDto,
    newVariants: VariantDto[],
  ): void {
    if (!Array.isArray(question.variants)) {
      question.variants = [];
    }

    let variantId = question.variants.length + 1;

    for (const variant of newVariants) {
      question.variants.push({
        ...variant,
        id: Number(`${question.id}${variantId++}`),
        choices: variant.choices,
        scoring: variant.scoring,
        variantType: variant.variantType,
        randomizedChoices: true,
      });
    }
  }

  private calculateRequiredVariants(
    totalQuestions: number,
    currentVariants: number,
    targetVariants: number,
  ): number {
    return totalQuestions > 1
      ? Math.max(0, targetVariants - currentVariants)
      : targetVariants;
  }

  /**
   * Convert a publish-payload entry into the Prisma update shape the repo
   * expects. Centralizes JSON column handling and keeps the publish loop
   * focused on routing decisions.
   */
  private buildQuestionUpdateData(
    questionDto: QuestionDto,
  ): Prisma.QuestionUpdateInput {
    // Distinguish "not in payload" (skip — leave column untouched) from
    // "explicitly null" (clear the column). Collapsing both to undefined
    // would leave stale MCQ choices/scoring on a question whose author just
    // switched it to TEXT.
    const toJsonInput = (
      value: unknown,
    ): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return Prisma.DbNull;
      }
      return value as Prisma.InputJsonValue;
    };

    return {
      totalPoints: questionDto.totalPoints ?? 0,
      type: questionDto.type,
      question: questionDto.question,
      authorComment: questionDto.authorComment ?? null,
      responseType: questionDto.responseType,
      maxWords: questionDto.maxWords,
      maxCharacters: questionDto.maxCharacters,
      randomizedChoices: questionDto.randomizedChoices,
      answer: questionDto.answer ?? false,
      choices: toJsonInput(questionDto.choices),
      scoring: toJsonInput(questionDto.scoring),
      videoPresentationConfig: toJsonInput(questionDto.videoPresentationConfig),
      liveRecordingConfig: toJsonInput(questionDto.liveRecordingConfig),
      gradingContextQuestionIds: questionDto.gradingContextQuestionIds,
      isDeleted: false,
    };
  }

  private async applyGuardRails(question: QuestionDto): Promise<void> {
    const isValid = await this.llmFacadeService.applyGuardRails(
      JSON.stringify(question),
    );

    if (!isValid) {
      throw new BadRequestException(
        "Question validation failed due to inappropriate or unacceptable content",
      );
    }
  }
}
