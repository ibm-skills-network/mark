import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ResponseType } from "@prisma/client";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
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
   * Process questions for publishing with detailed progress tracking, this is where the main logic for saving and updating assignments is
   *
   * @param assignmentId - The assignment ID
   * @param questions - Array of questions to process
   * @param jobId - Optional job ID for progress tracking
   */
  async processQuestionsForPublishing(
    assignmentId: number,
    questions: QuestionDto[],
    jobId?: number,
    progressCallback?: (progress: number) => Promise<void>,
    forceTranslation = false,
  ): Promise<void> {
    const INITIAL_SETUP_RANGE = { start: 0, end: 10 };
    const QUESTION_PROCESSING_RANGE = { start: 10, end: 90 };
    const FINAL_CLEANUP_RANGE = { start: 90, end: 100 };

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
      await updateProgress(
        INITIAL_SETUP_RANGE.start,
        "Retrieving existing questions",
      );

      const existingQuestions =
        await this.questionRepository.findByAssignmentId(assignmentId);

      await updateProgress(5, "Analyzing question changes");

      const frontendToBackendIdMap = new Map<number, number>();
      const newQuestionIds = new Set(questions.map((q) => q.id));
      const questionsToDelete = existingQuestions.filter(
        (q) => !newQuestionIds.has(q.id),
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

      for (const [index, questionDto] of questions.entries()) {
        const questionStartProgress =
          QUESTION_PROCESSING_RANGE.start + index * progressPerQuestion;
        const questionEndProgress = questionStartProgress + progressPerQuestion;

        await updateProgress(
          questionStartProgress + progressPerQuestion * 0.1,
          `Processing question ${index + 1} of ${totalQuestions}`,
        );

        const backendId =
          frontendToBackendIdMap.get(questionDto.id) || questionDto.id;
        const existingQuestion = existingQuestions.find(
          (q) => q.id === backendId,
        );

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

        const upsertedQuestion = await this.questionRepository.upsert({
          id: existingQuestion ? existingQuestion.id : questionDto.id,
          assignmentId,
          question: questionDto.question,
          type: questionDto.type,
          answer: questionDto.answer ?? false,
          totalPoints: questionDto.totalPoints ?? 0,
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
        });

        if (!existingQuestion) {
          frontendToBackendIdMap.set(questionDto.id, upsertedQuestion.id);
        }

        await updateProgress(
          questionStartProgress + progressPerQuestion * 0.5,
          `Translating question ${index + 1}`,
        );

        await this.translationService.translateQuestion(
          assignmentId,
          upsertedQuestion.id,
          questionDto,
          jobId || 0,
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
            upsertedQuestion.id,
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

      await updateProgress(
        FINAL_CLEANUP_RANGE.end,
        "Question processing completed successfully",
      );
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

  /**
   * Check if any variants have changed
   */
  private checkVariantsForChanges(
    existingVariants: VariantDto[],
    newVariants: VariantDto[],
  ): boolean {
    if (existingVariants.length !== newVariants.length) {
      return true;
    }
    const existingVariantsMap = new Map<number, VariantDto>();
    for (const v of existingVariants) existingVariantsMap.set(v.id, v);
    for (const newVariant of newVariants) {
      const existingVariant = existingVariantsMap.get(newVariant.id);
      if (
        !existingVariant ||
        existingVariant.variantContent !== newVariant.variantContent ||
        !this.areChoicesEqual(existingVariant.choices, newVariant.choices)
      ) {
        return true;
      }
    }
    return false;
  }

  async generateQuestions(
    assignmentId: number,
    payload: QuestionGenerationPayload,
    userId: string,
  ): Promise<{ message: string; jobId: number }> {
    this.validateQuestionGenerationPayload(payload);

    const job = await this.jobStatusService.createJob(assignmentId, userId);

    this.startQuestionGenerationProcess(
      assignmentId,
      job.id,
      payload.assignmentType,
      payload.questionsToGenerate,
      payload.fileContents,
      payload.learningObjectives,
    ).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Question generation failed: ${errorMessage}`,
        errorStack,
      );
    });

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

    const questionOrder = assignment.questionOrder || [];

    const sortedQuestions = [...assignment.questions].sort(
      (a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id),
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
  private async startQuestionGenerationProcess(
    assignmentId: number,
    jobId: number,
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
          progress: "Mark is thinking generating questions.",
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
      fileContents,
      learningObjectives,
      questionsToGenerate,
      assignmentId,
    } = payload;

    if (!fileContents && !learningObjectives) {
      throw new BadRequestException(
        "Either file contents or learning objectives are required",
      );
    }

    if (Number.isNaN(assignmentId)) {
      throw new BadRequestException("Invalid assignment ID");
    }

    const totalQuestions =
      (questionsToGenerate.multipleChoice || 0) +
      (questionsToGenerate.multipleSelect || 0) +
      (questionsToGenerate.textResponse || 0) +
      (questionsToGenerate.trueFalse || 0) +
      (questionsToGenerate.url || 0) +
      (questionsToGenerate.upload || 0) +
      (questionsToGenerate.linkFile || 0);

    if (totalQuestions <= 0) {
      throw new BadRequestException(
        "At least one question type must be selected with a count greater than 0",
      );
    }

    if (
      (questionsToGenerate.url > 0 ||
        questionsToGenerate.upload > 0 ||
        questionsToGenerate.linkFile > 0) &&
      !questionsToGenerate.responseTypes
    ) {
      questionsToGenerate.responseTypes = {
        TEXT: [ResponseType.OTHER],
        URL: [ResponseType.OTHER],
        UPLOAD: [ResponseType.OTHER],
        LINK_FILE: [ResponseType.OTHER],
      };
    }
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
    jobId?: number,
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
          jobId || 0,
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
          jobId || 0,
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
