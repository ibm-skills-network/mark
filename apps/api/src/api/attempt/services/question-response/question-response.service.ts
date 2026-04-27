/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import axios from "axios";
import * as cheerio from "cheerio";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  authorAssignmentDetailsDTO,
  LearnerUpdateAssignmentAttemptRequestDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionService } from "src/api/assignment/question/question.service";
import { QuestionAnswerContext } from "src/api/llm/model/base.question.evaluate.model";
import { Logger } from "winston";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { GradingContext } from "../../common/interfaces/grading-context.interface";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingProgressService } from "../grading-progress.service";

type PrismaTransactionalClient = Omit<
  PrismaService,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
>;

/**
 * A graded question item produced by Phase 2 (grading, no DB write).
 * Passed to commitAttemptWithResponses for Phase 3 (atomic DB write).
 */
export interface GradedItem {
  questionId: number;
  /** Raw extracted learner response (to be stored in QuestionResponse.learnerResponse) */
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
}

@Injectable()
export class QuestionResponseService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionService: QuestionService,
    private readonly localizationService: LocalizationService,
    private readonly gradingFactoryService: GradingFactoryService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Inject("GradingProgressService")
    private readonly progressService?: GradingProgressService,
  ) {
    this.logger = parentLogger.child({
      context: QuestionResponseService.name,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 1+2: Grade learner questions (no DB writes)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grade all questions for a learner submission without writing to the database.
   *
   * Phase 1 (short read tx): loads question DTOs and validates dependency order.
   * Phase 2 (no tx): calls LLM/grading strategies, maintains an in-memory context
   *   map so context questions graded earlier in the batch can be referenced without
   *   touching the DB.
   *
   * The caller is responsible for writing results via commitAttemptWithResponses().
   */
  async gradeQuestionsForLearner(
    responsesForQuestions: CreateQuestionResponseAttemptRequestDto[],
    assignmentAttemptId: number,
    assignmentId: number,
    language: string,
    preTranslatedQuestions?: Map<number, QuestionDto>,
  ): Promise<GradedItem[]> {
    // ── Phase 1: Read (short transaction) ────────────────────────────────────
    const { questionDtos, sorted, adj, inDegree } =
      await this.prisma.$transaction(
        async (tx) => {
          const questionDtos: QuestionDto[] = await Promise.all(
            responsesForQuestions.map(async (response) => {
              const { question } = await this.getLearnerQuestion(
                response.id,
                assignmentAttemptId,
                assignmentId,
                preTranslatedQuestions,
                tx as PrismaTransactionalClient,
              );
              return question;
            }),
          );
          const sortResult = this.buildAndSortDependencies(questionDtos);
          return { questionDtos, ...sortResult };
        },
        { timeout: 10_000 },
      );

    if (sorted.length !== responsesForQuestions.length) {
      const nodesInCycle: number[] = [];
      for (const [questionId, degree] of inDegree.entries()) {
        if (degree > 0) nodesInCycle.push(questionId);
      }
      this.logger.error(
        `Cycle detected in question dependencies for assignment ${assignmentId}`,
        { inDegree, adj, nodesInCycle },
      );
      throw new InternalServerErrorException(
        `A cycle was detected in the question dependencies: ${nodesInCycle.join(
          ", ",
        )}`,
      );
    }

    // ── Phase 2: Grade (no transaction) ──────────────────────────────────────
    const totalQuestions = sorted.length;
    if (this.progressService) {
      await this.progressService.initializeProgress(
        assignmentAttemptId,
        totalQuestions,
      );
    }

    const questionMap = new Map(questionDtos.map((q) => [q.id, q]));
    const requestMap = new Map(responsesForQuestions.map((r) => [r.id, r]));
    // In-memory responses for context questions graded earlier in this batch.
    // Key = questionId, value = JSON-stringified learnerResponse (matches DB format).
    const inMemoryContextResponses = new Map<number, string>();
    const gradedItems: GradedItem[] = [];

    for (const [index, questionId] of sorted.entries()) {
      const questionNumber = index + 1;
      const questionResponse = requestMap.get(questionId);
      if (!questionResponse) continue;

      if (this.progressService) {
        await this.progressService.updateQuestionProgress(
          assignmentAttemptId,
          questionNumber,
          totalQuestions,
          `Grading question ${questionNumber} of ${totalQuestions}...`,
        );
      }

      const question = questionMap.get(questionId);
      if (!question) continue;
      questionResponse.language = language;

      const assignmentContext = await this.getAssignmentContext(
        assignmentId,
        questionId,
        assignmentAttemptId,
        undefined,
        inMemoryContextResponses,
      );

      const { learnerResponse, responseDto } = await this.gradeQuestionNoSave(
        question,
        questionResponse,
        assignmentContext,
        assignmentId,
        language,
        UserRole.LEARNER,
        assignmentAttemptId,
      );

      // Make this response available as context for subsequent questions
      inMemoryContextResponses.set(
        questionId,
        JSON.stringify(learnerResponse ?? ""),
      );

      responseDto.questionId = questionId;
      responseDto.question = question.question;
      gradedItems.push({ questionId, learnerResponse, responseDto });
    }

    if (this.progressService) {
      await this.progressService.markComplete(assignmentAttemptId);
    }

    return gradedItems;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 3: Atomic write (QuestionResponse records + AssignmentAttempt grade)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Atomically write all graded question responses and update the AssignmentAttempt
   * grade in a single short transaction (<5s). This eliminates the gap between
   * QuestionResponse inserts and the grade update that could leave orphan state.
   *
   * Uses an optimistic lock on AssignmentAttempt.version to detect concurrent writes.
   * Throws ConflictException if the attempt was concurrently submitted by another worker.
   */
  async commitAttemptWithResponses(
    assignmentAttemptId: number,
    gradedItems: GradedItem[],
    grade: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
  ): Promise<{ id: number; submitted: boolean; grade: number | null }> {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      responsesForQuestions: _r,
      authorQuestions: _aq,
      authorAssignmentDetails: _aad,
      language,
      preTranslatedQuestions: _pt,
      expiresAt: _ignoredExpiresAt,
      ...cleanedUpdateDto
    } = updateDto;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    const current = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      select: { submitted: true },
    });

    if (!current) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    if (current.submitted) {
      throw new ConflictException(
        `Attempt ${assignmentAttemptId} has already been submitted.`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Write all QuestionResponse records
        for (const {
          questionId,
          learnerResponse,
          responseDto,
        } of gradedItems) {
          await this.saveResponseToDatabase(
            assignmentAttemptId,
            questionId,
            learnerResponse,
            responseDto,
            UserRole.LEARNER,
            tx as PrismaTransactionalClient,
          );
        }

        // Atomically update AssignmentAttempt only if it is still not submitted.
        const updateResult = await (
          tx as PrismaTransactionalClient
        ).assignmentAttempt.updateMany({
          where: {
            id: assignmentAttemptId,
            submitted: false,
          },
          data: {
            ...cleanedUpdateDto,
            submitted: true,
            preferredLanguage: language ?? "en",
            expiresAt: new Date(),
            grade,
          },
        });

        if (updateResult.count === 0) {
          throw new ConflictException(
            `Attempt ${assignmentAttemptId} was concurrently submitted. ` +
              `Grading results were discarded to prevent duplicate submission.`,
          );
        }

        return (tx as PrismaTransactionalClient).assignmentAttempt.findUnique({
          where: { id: assignmentAttemptId },
          select: { id: true, submitted: true, grade: true },
        });
      },
      { timeout: 60_000 },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy entry point (author preview + backward compat)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Submit all questions for an assignment attempt.
   *
   * For LEARNER: prefer the split gradeQuestionsForLearner() + commitAttemptWithResponses()
   * flow so that the grade write is atomic with the response writes. This method
   * is kept for AUTHOR preview (no DB writes) and for cases where the split API
   * is not available.
   */
  async submitQuestions(
    responsesForQuestions: CreateQuestionResponseAttemptRequestDto[],
    assignmentAttemptId: number,
    role: UserRole,
    assignmentId: number,
    language: string,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
    preTranslatedQuestions?: Map<number, QuestionDto>,
  ): Promise<CreateQuestionResponseAttemptResponseDto[]> {
    // ── Phase 1: Read (short transaction) ────────────────────────────────────
    const { questionDtos, sorted, adj, inDegree } =
      await this.prisma.$transaction(
        async (tx) => {
          const questionDtos: QuestionDto[] = await Promise.all(
            responsesForQuestions.map(async (response) => {
              const questionId = response.id;
              if (role === UserRole.LEARNER) {
                const { question } = await this.getLearnerQuestion(
                  questionId,
                  assignmentAttemptId,
                  assignmentId,
                  preTranslatedQuestions,
                  tx as PrismaTransactionalClient,
                );
                return question;
              } else if (role === UserRole.AUTHOR) {
                const { question } = this.getAuthorQuestion(
                  questionId,
                  authorQuestions,
                  assignmentDetails,
                );
                return question;
              } else {
                throw new BadRequestException(`Unsupported user role: ${role}`);
              }
            }),
          );
          const sortResult = this.buildAndSortDependencies(questionDtos);
          return { questionDtos, ...sortResult };
        },
        { timeout: 10_000 },
      );

    if (sorted.length !== responsesForQuestions.length) {
      const nodesInCycle = [];
      for (const [questionId, degree] of inDegree.entries()) {
        if (degree > 0) {
          nodesInCycle.push(questionId);
        }
      }
      this.logger.error(
        `Cycle detected in question dependencies for assignment ${assignmentId}`,
        { inDegree, adj, nodesInCycle },
      );
      throw new InternalServerErrorException(
        `A cycle was detected in the question dependencies: ${nodesInCycle.join(
          ", ",
        )}`,
      );
    }

    // ── Phase 2: Grade (no transaction) ──────────────────────────────────────
    const totalQuestions = sorted.length;
    if (this.progressService && role === UserRole.LEARNER) {
      await this.progressService.initializeProgress(
        assignmentAttemptId,
        totalQuestions,
      );
    }

    const questionMap = new Map(questionDtos.map((q) => [q.id, q]));
    const requestMap = new Map(responsesForQuestions.map((r) => [r.id, r]));
    const inMemoryContextResponses = new Map<number, string>();
    const gradedItems: GradedItem[] = [];

    for (const [index, questionId] of sorted.entries()) {
      const questionNumber = index + 1;
      const questionResponse = requestMap.get(questionId);
      if (!questionResponse) continue;

      if (this.progressService && role === UserRole.LEARNER) {
        await this.progressService.updateQuestionProgress(
          assignmentAttemptId,
          questionNumber,
          totalQuestions,
          `Grading question ${questionNumber} of ${totalQuestions}...`,
        );
      }

      const question = questionMap.get(questionId);
      if (!question) continue;
      questionResponse.language = language;

      const assignmentContext: {
        assignmentInstructions: string;
        questionAnswerContext: QuestionAnswerContext[];
      } =
        role === UserRole.LEARNER
          ? await this.getAssignmentContext(
              assignmentId,
              questionId,
              assignmentAttemptId,
              undefined,
              inMemoryContextResponses,
            )
          : {
              assignmentInstructions: assignmentDetails?.instructions ?? "",
              questionAnswerContext: [],
            };

      const { learnerResponse, responseDto } = await this.gradeQuestionNoSave(
        question,
        questionResponse,
        assignmentContext,
        assignmentId,
        language,
        role,
        assignmentAttemptId,
      );

      inMemoryContextResponses.set(
        questionId,
        JSON.stringify(learnerResponse ?? ""),
      );
      responseDto.questionId = questionId;
      responseDto.question = question.question;
      gradedItems.push({ questionId, learnerResponse, responseDto });
    }

    if (this.progressService && role === UserRole.LEARNER) {
      await this.progressService.markComplete(assignmentAttemptId);
    }

    // ── Phase 3: Write (short transaction) — LEARNER only ────────────────────
    if (role !== UserRole.AUTHOR) {
      await this.prisma.$transaction(
        async (tx) => {
          for (const {
            questionId,
            learnerResponse,
            responseDto,
          } of gradedItems) {
            await this.saveResponseToDatabase(
              assignmentAttemptId,
              questionId,
              learnerResponse,
              responseDto,
              role,
              tx as PrismaTransactionalClient,
            );
          }
        },
        { timeout: 60_000 },
      );
    }

    return gradedItems.map((g) => g.responseDto);
  }

  private buildAndSortDependencies(questions: QuestionDto[]): {
    sorted: number[];
    adj: Map<number, number[]>;
    inDegree: Map<number, number>;
  } {
    const adj = new Map<number, number[]>();
    const inDegree = new Map<number, number>();
    const questionIds = new Set(questions.map((q) => q.id));

    for (const q of questions) {
      adj.set(q.id, []);
      inDegree.set(q.id, 0);
    }

    for (const q of questions) {
      for (const depId of q.gradingContextQuestionIds ?? []) {
        if (questionIds.has(depId)) {
          const dependentQuestions = adj.get(depId);
          if (!dependentQuestions) {
            continue;
          }
          dependentQuestions.push(q.id);
          inDegree.set(q.id, (inDegree.get(q.id) ?? 0) + 1);
        }
      }
    }

    const queue = questions
      .filter((q) => (inDegree.get(q.id) ?? 0) === 0)
      .map((q) => q.id);
    const sorted: number[] = [];

    while (queue.length > 0) {
      const u = queue.shift();
      if (u === undefined) {
        continue;
      }
      sorted.push(u);

      for (const v of adj.get(u) ?? []) {
        inDegree.set(v, (inDegree.get(v) ?? 0) - 1);
        if ((inDegree.get(v) ?? 0) === 0) {
          queue.push(v);
        }
      }
    }

    return { sorted, adj, inDegree };
  }

  /**
   * Create a question response (used by autoSave — writes immediately)
   */
  async createQuestionResponse(
    assignmentAttemptId: number,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    role: UserRole,
    assignmentId: number,
    language: string,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
    preTranslatedQuestions?: Map<number, QuestionDto>,
    tx?: PrismaTransactionalClient,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    const questionId = createQuestionResponseAttemptRequestDto.id;

    createQuestionResponseAttemptRequestDto.language = language;

    let question: QuestionDto;
    let assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };

    if (role === UserRole.LEARNER) {
      ({ question, assignmentContext } = await this.getLearnerQuestion(
        questionId,
        assignmentAttemptId,
        assignmentId,
        preTranslatedQuestions,
        tx,
      ));
    } else if (role === UserRole.AUTHOR) {
      ({ question, assignmentContext } = this.getAuthorQuestion(
        questionId,
        authorQuestions,
        assignmentDetails,
      ));
    } else {
      throw new BadRequestException(`Unsupported user role: ${role}`);
    }

    const { learnerResponse, responseDto } = await this.gradeQuestionNoSave(
      question,
      createQuestionResponseAttemptRequestDto,
      assignmentContext,
      assignmentId,
      language,
      role,
      assignmentAttemptId,
    );

    if (role !== UserRole.AUTHOR) {
      await this.saveResponseToDatabase(
        assignmentAttemptId,
        questionId,
        learnerResponse,
        responseDto,
        role,
        tx,
      );
    }

    responseDto.questionId = questionId;
    responseDto.question = question.question;

    return responseDto;
  }

  /**
   * Grade a single question without writing to the database.
   * Used by both the gradeQuestionsForLearner Phase 2 and the legacy submitQuestions.
   */
  private async gradeQuestionNoSave(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
    language: string,
    role: UserRole,
    assignmentAttemptId: number,
  ): Promise<{
    learnerResponse: unknown;
    responseDto: CreateQuestionResponseAttemptResponseDto;
  }> {
    const questionId = question.id;

    if (this.isEmptyResponse(requestDto)) {
      const { responseDto, learnerResponse } =
        this.handleEmptyResponse(language);
      responseDto.questionId = questionId;
      responseDto.question = question.question;
      return { learnerResponse, responseDto };
    }

    const gradingContext: GradingContext = {
      assignmentInstructions: assignmentContext.assignmentInstructions,
      questionAnswerContext: assignmentContext.questionAnswerContext,
      assignmentId,
      language,
      userRole: role,
      metadata: {
        attemptId: assignmentAttemptId,
        questionType: question.type,
        responseType: question.responseType,
      },
    };

    let responseDto: CreateQuestionResponseAttemptResponseDto;
    let learnerResponse: unknown;

    try {
      if (question.type === QuestionType.LINK_FILE) {
        ({ responseDto, learnerResponse } = await this.handleLinkFileQuestion(
          question,
          requestDto,
          gradingContext,
        ));
      } else {
        const startTime = Date.now();

        this.logger.info("Starting question grading process", {
          questionId,
          questionType: question.type,
          responseType: question.responseType,
          assignmentId,
          assignmentAttemptId,
          userRole: role,
          language,
        });

        const gradingStrategy = this.gradingFactoryService.getStrategy(
          question.type,
          question.responseType,
        );

        if (!gradingStrategy) {
          this.logger.error("No grading strategy found", {
            questionId,
            questionType: question.type,
            responseType: question.responseType,
          });
          throw new BadRequestException(
            `No grading strategy found for question type: ${question.type}`,
          );
        }

        this.logger.info("Using grading strategy", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
          questionType: question.type,
          responseType: question.responseType,
        });

        this.logger.debug("Validating response", { questionId });
        const isValid = await gradingStrategy.validateResponse(
          question,
          requestDto,
        );

        if (!isValid) {
          this.logger.warn("Response validation failed", {
            questionId,
            language: requestDto.language,
            strategyName: gradingStrategy.constructor.name,
          });
          throw new BadRequestException(
            `Invalid response for question ID ${questionId}: ${requestDto.language}`,
          );
        }

        this.logger.debug("Extracting learner response", { questionId });
        learnerResponse =
          await gradingStrategy.extractLearnerResponse(requestDto);

        this.logger.info("Grading response with strategy", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
        });

        responseDto = await gradingStrategy.gradeResponse(
          question,
          learnerResponse,
          gradingContext,
        );

        if (!responseDto) {
          this.logger.error("Strategy returned null/undefined response", {
            questionId,
            strategyName: gradingStrategy.constructor.name,
          });
          throw new BadRequestException(
            `Failed to grade response for question ID ${questionId}`,
          );
        }

        const duration = Date.now() - startTime;
        this.logger.info("Successfully completed question grading", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
          totalPoints: responseDto.totalPoints,
          maxPoints: question.totalPoints,
          duration,
          feedback: responseDto.feedback ? "present" : "missing",
        });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error("Failed to process question response", {
        questionId,
        questionType: question.type,
        responseType: question.responseType,
        assignmentId,
        assignmentAttemptId,
        userRole: role,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new BadRequestException(
        `Failed to process question response: ${errorMessage}`,
      );
    }

    return { learnerResponse, responseDto };
  }

  /**
   * Handle LINK_FILE question type which can accept either URL or File
   */
  private async handleLinkFileQuestion(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    gradingContext: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: any;
  }> {
    if (requestDto.learnerUrlResponse) {
      const urlGradingStrategy = this.gradingFactoryService.getStrategy(
        QuestionType.URL,
      );
      const url = requestDto.learnerUrlResponse;
      const rawUrl = this.convertGitHubUrlToRaw(url);
      if (rawUrl) {
        requestDto.learnerUrlResponse = rawUrl;
      }
      const isValid = await urlGradingStrategy.validateResponse(
        question,
        requestDto,
      );
      if (!isValid) {
        throw new BadRequestException(
          `Invalid URL response for question ID ${question.id}: ${requestDto.language}`,
        );
      }
      const learnerResponse =
        await urlGradingStrategy.extractLearnerResponse(requestDto);
      const responseDto = await urlGradingStrategy.gradeResponse(
        question,
        learnerResponse,
        gradingContext,
      );
      return { responseDto, learnerResponse };
    } else if (requestDto.learnerFileResponse) {
      let responseType: string | undefined;
      if (question.responseType === "IMAGES") {
        responseType = question.responseType;
      }
      const fileGradingStrategy = this.gradingFactoryService.getStrategy(
        QuestionType.UPLOAD,
        responseType,
      );
      const isValid = await fileGradingStrategy.validateResponse(
        question,
        requestDto,
      );
      if (!isValid) {
        throw new BadRequestException(
          `Invalid file response for question ID ${question.id}: ${requestDto.language}`,
        );
      }
      const learnerResponse =
        await fileGradingStrategy.extractLearnerResponse(requestDto);
      const responseDto = await fileGradingStrategy.gradeResponse(
        question,
        learnerResponse,
        gradingContext,
      );
      return { responseDto, learnerResponse };
    }

    throw new BadRequestException(
      "Expected a file-based or URL-based response, but did not receive one.",
    );
  }

  /**
   * Save a question response to the database
   */
  private async saveResponseToDatabase(
    assignmentAttemptId: number,
    questionId: number,
    learnerResponse: any,
    responseDto: CreateQuestionResponseAttemptResponseDto,
    role: UserRole,
    tx?: PrismaTransactionalClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;
    try {
      type FeedbackWithUrl = { annotatedPdfUrl?: string };
      const feedbackArray: FeedbackWithUrl[] = Array.isArray(
        responseDto.feedback,
      )
        ? (responseDto.feedback as FeedbackWithUrl[])
        : [];
      const annotatedPdfUrls = feedbackArray
        .map((feedback) => feedback.annotatedPdfUrl)
        .filter((url): url is string => typeof url === "string");
      const hasAnnotatedPdf = annotatedPdfUrls.length > 0;
      if (hasAnnotatedPdf) {
        this.logger.info(
          "[saveResponseToDatabase] Saving response with annotatedPdfUrl",
          {
            questionId,
            attemptId: assignmentAttemptId,
            feedbackCount: feedbackArray.length,
            annotatedPdfUrls,
          },
        );
      }

      const result = await prisma.questionResponse.create({
        data: {
          assignmentAttemptId:
            role === UserRole.LEARNER ? assignmentAttemptId : 1,
          questionId: questionId,
          learnerResponse: JSON.stringify(learnerResponse ?? ""),
          points: responseDto.totalPoints ?? 0,
          feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
          metadata: responseDto.metadata
            ? JSON.stringify(responseDto.metadata)
            : null,
          gradedAt: new Date(),
        },
      });

      responseDto.id = result.id;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to save question response", {
        questionId,
        assignmentAttemptId,
        role,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new InternalServerErrorException(
        `Failed to save question response: ${errorMessage}`,
      );
    }
  }

  /**
   * Get question and context information for a learner
   */
  private async getLearnerQuestion(
    questionId: number,
    assignmentAttemptId: number,
    assignmentId: number,
    preTranslatedQuestions?: Map<number, QuestionDto>,
    tx?: PrismaTransactionalClient,
  ): Promise<{
    question: QuestionDto;
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
  }> {
    const prisma = tx ?? this.prisma;
    if (preTranslatedQuestions && preTranslatedQuestions.has(questionId)) {
      const question = preTranslatedQuestions.get(questionId);
      const assignmentContext = await this.getAssignmentContext(
        assignmentId,
        questionId,
        assignmentAttemptId,
        tx,
      );
      return { question, assignmentContext };
    }

    const assignmentAttempt = await prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionVariants: {
          select: {
            questionId: true,
            questionVariant: { include: { variantOf: true } },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    const variantMapping = assignmentAttempt.questionVariants.find(
      (qv) => qv.questionId === questionId,
    );

    let question: QuestionDto;

    if (variantMapping && variantMapping.questionVariant !== null) {
      const variant = variantMapping.questionVariant;
      const baseQuestion = variant.variantOf;

      question = {
        id: baseQuestion.id,
        question: variant.variantContent,
        type: baseQuestion.type,
        assignmentId: baseQuestion.assignmentId,
        maxWords: variant.maxWords ?? baseQuestion.maxWords,
        maxCharacters: variant.maxCharacters ?? baseQuestion.maxCharacters,
        scoring:
          this.parseJsonField(variant.scoring) ??
          this.parseJsonField(baseQuestion.scoring),
        choices:
          this.parseJsonField(variant.choices) ??
          this.parseJsonField(baseQuestion.choices),
        answer: baseQuestion.answer ?? variant.answer,
        alreadyInBackend: true,
        totalPoints: baseQuestion.totalPoints,
        responseType: baseQuestion.responseType,
        gradingContextQuestionIds: baseQuestion.gradingContextQuestionIds ?? [],
        videoPresentationConfig: baseQuestion.videoPresentationConfig
          ? this.parseJsonField(baseQuestion.videoPresentationConfig)
          : null,
      };
    } else {
      question = await this.questionService.findOne(questionId, tx);
    }

    const assignmentContext = await this.getAssignmentContext(
      assignmentId,
      questionId,
      assignmentAttemptId,
      tx,
    );

    return { question, assignmentContext };
  }

  /**
   * Get question and context information for an author
   */
  private getAuthorQuestion(
    questionId: number,
    authorQuestions: QuestionDto[],
    assignmentDetails: any,
  ): {
    question: QuestionDto;
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
  } {
    const question = authorQuestions.find((q) => q.id === questionId);

    if (!question) {
      throw new NotFoundException(
        `Question with ID ${questionId} not found in author questions.`,
      );
    }

    const assignmentContext = {
      assignmentInstructions: assignmentDetails?.instructions ?? "",
      questionAnswerContext: [],
    };

    return { question, assignmentContext };
  }

  /**
   * Get assignment context for grading.
   *
   * @param inMemoryResponses - Optional map of questionId → JSON-stringified learnerResponse.
   *   When provided (Phase 2 grading), context responses are read from memory instead of the
   *   database so we don't need to write them first.
   */
  private async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
    tx?: PrismaTransactionalClient,
    inMemoryResponses?: Map<number, string>,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    const prisma = tx ?? this.prisma;
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { instructions: true },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found.`,
      );
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { gradingContextQuestionIds: true },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID ${questionId} not found.`);
    }

    if (
      !question.gradingContextQuestionIds ||
      question.gradingContextQuestionIds.length === 0
    ) {
      return {
        assignmentInstructions: assignment.instructions || "",
        questionAnswerContext: [],
      };
    }

    const contextQuestions = await prisma.question.findMany({
      where: {
        id: {
          in: question.gradingContextQuestionIds,
        },
      },
      select: { id: true, question: true, type: true },
    });

    // Build the response lookup: prefer in-memory (Phase 2) over DB
    const responsesByQuestionId: Record<number, string> = {};
    if (inMemoryResponses && inMemoryResponses.size > 0) {
      for (const contextQ of contextQuestions) {
        const inMemory = inMemoryResponses.get(contextQ.id);
        if (inMemory !== undefined) {
          responsesByQuestionId[contextQ.id] = inMemory;
        }
      }
    }

    // Fall back to DB for any context questions not yet in memory
    const missingIds = contextQuestions
      .filter((contextQ) => responsesByQuestionId[contextQ.id] === undefined)
      .map((contextQ) => contextQ.id);

    if (missingIds.length > 0) {
      const questionResponses = await prisma.questionResponse.findMany({
        where: {
          assignmentAttemptId: assignmentAttemptId,
          questionId: { in: missingIds },
        },
        orderBy: { id: "desc" },
      });

      const seenIds = new Set<number>();
      for (const response of questionResponses) {
        if (!seenIds.has(response.questionId)) {
          seenIds.add(response.questionId);
          responsesByQuestionId[response.questionId] = response.learnerResponse;
        }
      }
    }

    const questionAnswerContext = await Promise.all(
      contextQuestions.map(async (contextQuestion) => {
        let learnerResponse = responsesByQuestionId[contextQuestion.id] || "";

        if (contextQuestion.type === QuestionType.URL && learnerResponse) {
          try {
            let urlValue: string | { url: string };
            if (typeof learnerResponse === "string") {
              urlValue = this.isJsonString(learnerResponse)
                ? (JSON.parse(learnerResponse) as { url: string })
                : learnerResponse;
            } else {
              urlValue = learnerResponse as { url: string };
            }

            const url =
              typeof urlValue === "object" ? urlValue.url : String(urlValue);

            const content = await this.fetchUrlContent(String(url));

            learnerResponse = JSON.stringify({
              url,
              content: content.body,
              isFunctional: content.isFunctional,
            });
          } catch {
            // Ignore URL fetch failures while building learner context.
          }
        }

        return {
          question: contextQuestion.question,
          answer: learnerResponse,
          questionId: contextQuestion.id,
          questionType: contextQuestion.type,
        };
      }),
    );

    return {
      assignmentInstructions: assignment.instructions || "",
      questionAnswerContext,
    };
  }

  /**
   * Check if a string is valid JSON
   */
  private isJsonString(string_: string): boolean {
    try {
      JSON.parse(string_);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a response is empty
   */
  private isEmptyResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): boolean {
    return (
      (!requestDto.learnerFileResponse ||
        requestDto.learnerFileResponse.length === 0) &&
      (!requestDto.learnerUrlResponse ||
        (typeof requestDto.learnerUrlResponse === "string" &&
          requestDto.learnerUrlResponse.trim() === "")) &&
      (!requestDto.learnerTextResponse ||
        (typeof requestDto.learnerTextResponse === "string" &&
          requestDto.learnerTextResponse.trim() === "")) &&
      (!requestDto.learnerChoices || requestDto.learnerChoices.length === 0) &&
      requestDto.learnerAnswerChoice === null &&
      (!requestDto.learnerPresentationResponse ||
        (Array.isArray(requestDto.learnerPresentationResponse) &&
          requestDto.learnerPresentationResponse.length === 0))
    );
  }

  /**
   * Handle an empty response
   */
  private handleEmptyResponse(language: string): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = 0;

    const noResponseFeedback = new GeneralFeedbackDto();
    noResponseFeedback.feedback = this.localizationService.getLocalizedString(
      "noResponse",
      language,
    );

    responseDto.feedback = [noResponseFeedback];

    return { responseDto, learnerResponse: "" };
  }

  /**
   * Parse a JSON field from a database record
   */
  private parseJsonField(field: any): any {
    if (!field) return null;

    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch {
        return null;
      }
    }

    return field;
  }

  /**
   * Convert GitHub blob URL to raw content URL
   */
  private convertGitHubUrlToRaw(url: string): string | null {
    const match = url.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
    );
    if (!match) {
      return null;
    }
    const [, user, repo, path] = match;
    return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
  }

  /**
   * Fetch content from a URL
   */
  private async fetchUrlContent(
    url: string,
  ): Promise<{ body: string; isFunctional: boolean }> {
    const MAX_CONTENT_SIZE = 100_000;
    try {
      if (url.includes("github.com")) {
        if (url.includes("/blob/")) {
          const rawUrl = this.convertGitHubUrlToRaw(url);
          if (!rawUrl) {
            return { body: "", isFunctional: false };
          }

          const rawContentResponse = await axios.get<string>(rawUrl);
          if (rawContentResponse.status === 200) {
            let body = rawContentResponse.data;
            if (body.length > MAX_CONTENT_SIZE) {
              body = body.slice(0, MAX_CONTENT_SIZE);
            }
            return { body, isFunctional: true };
          }
        } else {
          try {
            const repoMatch = url.match(
              /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/,
            );
            if (repoMatch) {
              const [, user, repo] = repoMatch;

              const readmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/README.md`;
              try {
                const readmeResponse = await axios.get<string>(readmeUrl);
                if (readmeResponse.status === 200) {
                  let body = readmeResponse.data;
                  if (body.length > MAX_CONTENT_SIZE) {
                    body = body.slice(0, MAX_CONTENT_SIZE);
                  }
                  return { body, isFunctional: true };
                }
              } catch {
                try {
                  const masterReadmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/master/README.md`;
                  const masterReadmeResponse =
                    await axios.get<string>(masterReadmeUrl);
                  if (masterReadmeResponse.status === 200) {
                    let body = masterReadmeResponse.data;
                    if (body.length > MAX_CONTENT_SIZE) {
                      body = body.slice(0, MAX_CONTENT_SIZE);
                    }
                    return { body, isFunctional: true };
                  }
                } catch {
                  const apiUrl = `https://api.github.com/repos/${user}/${repo}`;
                  try {
                    const apiResponse = await axios.get(apiUrl);
                    if (apiResponse.status === 200) {
                      const repoInfo = apiResponse.data;
                      const body = `Repository: ${
                        repoInfo.full_name
                      }\nDescription: ${
                        repoInfo.description || "No description"
                      }\nStars: ${repoInfo.stargazers_count}\nForks: ${
                        repoInfo.forks_count
                      }\nLanguage: ${
                        repoInfo.language || "Not specified"
                      }\nLast Updated: ${repoInfo.updated_at}`;
                      return { body, isFunctional: true };
                    }
                  } catch {
                    return { body: "", isFunctional: false };
                  }
                }
              }
            }
          } catch {
            return { body: "", isFunctional: false };
          }

          try {
            const response = await axios.get<string>(url);
            const $ = cheerio.load(response.data);

            $(
              "script, style, noscript, iframe, noembed, embed, object",
            ).remove();

            let content = "";
            const readmeElement = $("article.markdown-body");
            if (readmeElement.length > 0) {
              content = readmeElement.text().trim();
            } else {
              const aboutSection = $(".Box-body");
              if (aboutSection.length > 0) {
                content += aboutSection.text().trim() + "\n\n";
              }

              const fileList = $(
                "div.js-details-container div.js-navigation-container tr.js-navigation-item",
              );
              if (fileList.length > 0) {
                content += "Repository Files:\n";
                fileList.each((index, element) => {
                  const fileName = $(element)
                    .find(".js-navigation-open")
                    .text()
                    .trim();
                  if (fileName) {
                    content += `- ${fileName}\n`;
                  }
                });
              }
            }

            if (content) {
              return {
                body: content.replaceAll(/\s+/g, " ").trim(),
                isFunctional: true,
              };
            }
          } catch {
            // Ignore HTTP parsing failures and fall back to an empty response.
          }
        }

        return { body: "", isFunctional: false };
      } else {
        const response = await axios.get<string>(url);
        const $ = cheerio.load(response.data);

        $("script, style, noscript, iframe, noembed, embed, object").remove();

        const plainText = $("body").text().trim().replaceAll(/\s+/g, " ");

        return { body: plainText, isFunctional: true };
      }
    } catch {
      return { body: "", isFunctional: false };
    }
  }
}
