/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { applyQuestionOrder } from "src/api/assignment/utils/question-order.util";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobQueueService } from "src/job-queue/job-queue.service";
import { Logger } from "winston";
import {
  getAllLanguageCodes,
  getLanguageNameFromCode,
} from "../../attempt/helper/languages";
import { JobStateRecord } from "src/job-queue/job-state.types";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import { EnhancedQuestionsToGenerate } from "../../dto/post.assignment.request.dto";
import { ReplaceAssignmentRequestDto } from "../../dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "../../dto/update.assignment.request.dto";
import {
  Choice,
  GenerateQuestionVariantDto,
  QuestionDto,
  VariantDto,
  VariantType,
} from "../../dto/update.questions.request.dto";
import { LLMResponseQuestion } from "../../question/dto/create.update.question.request.dto";

@Injectable()
export class AssignmentServiceV1 {
  private logger: Logger;
  private languageTranslation: boolean;
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV1,
    private readonly jobQueueService: JobQueueService,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "AssignmentServiceV1" });
    this.languageTranslation =
      process.env.NODE_ENV === "development" ? false : true;
  }
  async createJob(
    assignmentId: number,
    userId: string,
  ): Promise<JobStateRecord> {
    return this.jobStatusService.createJob(assignmentId, userId);
  }

  async get(
    assignmentId: number,
    userSession: UserSession,
    lang?: string,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const backendData = await this.findOne(Number(assignmentId), userSession);

    const originalLanguage = await this.llmFacadeService.getLanguageCode(
      backendData.introduction || "en",
    );

    if (lang && lang !== originalLanguage) {
      const assignmentTranslation =
        await this.prisma.assignmentTranslation.findUnique({
          where: {
            assignmentId_languageCode: {
              assignmentId,
              languageCode: lang,
            },
          },
        });
      if (assignmentTranslation) {
        backendData.name =
          assignmentTranslation.translatedName ?? backendData.name;
        backendData.introduction =
          assignmentTranslation.translatedIntroduction ||
          backendData.introduction;
        backendData.instructions =
          assignmentTranslation.translatedInstructions ||
          backendData.instructions;
        backendData.gradingCriteriaOverview =
          assignmentTranslation.translatedGradingCriteriaOverview ||
          backendData.gradingCriteriaOverview;
      }
    }

    if (userSession.role === UserRole.LEARNER) {
      return {
        ...backendData,
        questions: undefined,
      };
    }

    return {
      ...backendData,
      questions: backendData.questions.map((q) => ({
        ...q,
        alreadyInBackend: true,
      })),
    };
  }
  async findOne(
    id: number,
    userSession: UserSession,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const isLearner = userSession.role === UserRole.LEARNER;

    let result: any;

    if (isLearner) {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id },
        include: {
          currentVersion: {
            include: {
              questionVersions: { orderBy: { displayOrder: "asc" } },
            },
          },
        },
      });

      if (!assignment) {
        throw new NotFoundException(`Assignment with Id ${id} not found.`);
      }

      if (assignment.currentVersion) {
        const version = assignment.currentVersion;

        result = {
          id: assignment.id,
          name: version.name,
          introduction: version.introduction,
          instructions: version.instructions,
          gradingCriteriaOverview: version.gradingCriteriaOverview,
          timeEstimateMinutes: version.timeEstimateMinutes,
          type: version.type,
          graded: version.graded,
          numAttempts: version.numAttempts,
          attemptsBeforeCoolDown: version.attemptsBeforeCoolDown,
          retakeAttemptCoolDownMinutes: version.retakeAttemptCoolDownMinutes,
          allotedTimeMinutes: version.allotedTimeMinutes,
          attemptsPerTimeRange: version.attemptsPerTimeRange,
          attemptsTimeRangeHours: version.attemptsTimeRangeHours,
          passingGrade: version.passingGrade,
          displayOrder: version.displayOrder,
          questionDisplay: version.questionDisplay,
          numberOfQuestionsPerAttempt: version.numberOfQuestionsPerAttempt,
          questionOrder: version.questionOrder,
          published: version.published,
          showAssignmentScore: version.showAssignmentScore,
          showQuestionScore: version.showQuestionScore,
          showSubmissionFeedback: version.showSubmissionFeedback,
          showQuestions: version.showQuestions,
          languageCode: version.languageCode,
          updatedAt: assignment.updatedAt,
          questions: version.questionVersions.map((qv: any) => ({
            id: qv.questionId || qv.id,
            totalPoints: qv.totalPoints,
            type: qv.type,
            responseType: qv.responseType,
            question: qv.question,
            maxWords: qv.maxWords,
            scoring: qv.scoring,
            choices: qv.choices,
            randomizedChoices: qv.randomizedChoices,
            answer: qv.answer,
            gradingContextQuestionIds: qv.gradingContextQuestionIds,
            maxCharacters: qv.maxCharacters,
            videoPresentationConfig: qv.videoPresentationConfig,
            liveRecordingConfig: qv.liveRecordingConfig,
            displayOrder: qv.displayOrder,
            isDeleted: false,
            variants: [],
          })),
        };
      } else {
        result = await this.prisma.assignment.findUnique({
          where: { id },
          include: {
            questions: {
              include: { variants: true },
            },
          },
        });
      }
    } else {
      result = await this.prisma.assignment.findUnique({
        where: { id },
        include: {
          questions: {
            include: { variants: true },
          },
        },
      });
    }

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const filteredQuestions = result.questions.filter((q) => !q.isDeleted);

    for (const question of filteredQuestions) {
      if (question.variants) {
        question.variants = question.variants.filter((v) => !v.isDeleted);
      }
    }

    result.questions = filteredQuestions;

    for (const question of result.questions) {
      if (question.variants) {
        for (const variant of question.variants) {
          if (typeof variant.choices === "string") {
            try {
              variant.choices = JSON.parse(
                variant.choices,
              ) as unknown as Prisma.JsonValue;
            } catch {
              variant.choices = [];
            }
          }
        }
      }
    }
    if (result.questions) {
      result.questions = applyQuestionOrder(
        result.questions,
        result.questionOrder,
      );
    }

    if (isLearner) {
      return {
        ...result,
        success: true,
      } as LearnerGetAssignmentResponseDto;
    }

    return {
      ...result,
      success: true,
    } as GetAssignmentResponseDto;
  }

  async list(userSession: UserSession): Promise<AssignmentResponseDto[]> {
    if (userSession.role === UserRole.AUTHOR) {
      const authoredAssignments = await this.prisma.assignment.findMany({
        where: {
          AssignmentAuthor: {
            some: {
              userId: userSession.userId,
            },
          },
        },
      });

      return authoredAssignments as AssignmentResponseDto[];
    }

    const results = await this.prisma.assignmentGroup.findMany({
      where: { groupId: userSession.groupId },
      include: {
        assignment: true,
      },
    });

    if (!results) {
      throw new NotFoundException(
        `Group with Id ${userSession.groupId} not found.`,
      );
    }

    return results.map((result) => ({
      ...result.assignment,
    })) as AssignmentResponseDto[];
  }

  async replace(
    id: number,
    replaceAssignmentDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: {
        ...this.createEmptyDto(),
        ...replaceAssignmentDto,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Handles the uploaded files by processing their content asynchronously.
   * @param assignmentId The id of the assignment.
   * @param files The uploaded files array.
   * @param jobId The ID of the job to update status and progress.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async handleFileContents(
    assignmentId: number,
    jobId: string,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    try {
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ASSIGNMENT_V1,
        JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
        {
          assignmentId,
          assignmentType,
          files,
          jobId,
          learningObjectives,
          questionsToGenerate,
        },
        {
          jobId: String(jobId),
        },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.jobStatusService.updateJobStatus(
        jobId,
        `Failed to enqueue job: ${errorMessage}`,
        "Failed",
      );
      throw error;
    }
  }
  async runGenerateQuestionsJob(
    assignmentId: number,
    jobId: string,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    try {
      let content = "";
      if (files) {
        await this.jobStatusService.updateJobStatus(
          jobId,
          "Mark is organizing the notes merging file contents.",
        );

        const mergedContent = files.map((file) => file.content).join("\n");

        await this.jobStatusService.updateJobStatus(
          jobId,
          "Mark is proofreading the content sanitizing material.",
        );

        content = this.llmFacadeService.sanitizeContent(mergedContent);
      }

      await this.prisma.job.update({
        where: { id: Number(jobId) },
        data: {
          progress: "Mark is brainstorming some questions.",
        },
      });

      const llmResponse = (await this.llmFacadeService.processMergedContent(
        assignmentId,
        assignmentType,
        questionsToGenerate,
        content,
        learningObjectives,
      )) as LLMResponseQuestion[];

      await this.jobStatusService.updateJobStatus(
        jobId,
        "Mark has prepared the questions. Job completed successfully.",
        "Completed",
        llmResponse,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Error processing job ID ${jobId}: ${(error as Error).message}`,
      );

      await this.jobStatusService.updateJobStatus(
        jobId,
        "Mark hit a snag, we are sorry for the inconvenience",
        "Failed",
      );
    }
  }

  async update(
    id: number,
    updateAssignmentDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];

    const existingAssignment = await this.prisma.assignment.findUnique({
      where: { id },
    });

    const assignmentTranslation =
      await this.prisma.assignmentTranslation.findFirst({
        where: { assignmentId: id, languageCode: "en" },
      });
    if (!existingAssignment) {
      throw new NotFoundException("Assignment not found.");
    }

    let shouldTranslate = false;
    const {
      name,
      instructions,
      introduction,
      gradingCriteriaOverview,
      published,
    } = updateAssignmentDto;
    if (
      name &&
      (name !== existingAssignment.name || name !== assignmentTranslation.name)
    ) {
      shouldTranslate = true;
    }
    if (
      instructions &&
      (instructions !== existingAssignment.instructions ||
        instructions !== assignmentTranslation.instructions)
    ) {
      shouldTranslate = true;
    }
    if (
      introduction &&
      (introduction !== existingAssignment.introduction ||
        introduction !== assignmentTranslation.introduction)
    ) {
      shouldTranslate = true;
    }
    if (
      gradingCriteriaOverview &&
      (gradingCriteriaOverview !== existingAssignment.gradingCriteriaOverview ||
        gradingCriteriaOverview !==
          assignmentTranslation.gradingCriteriaOverview)
    ) {
      shouldTranslate = true;
    }

    if (published) {
      await this.handleQuestionGradingContext(id);
    }
    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    if (shouldTranslate) {
      await this.handleAssignmentTranslations(id, supportedLanguages);
    }

    return {
      id: result.id,
      success: true,
    };
  }


  private async handleAssignmentTranslations(
    assignmentId: number,
    languages: string[],
    job?: JobStateRecord,
  ): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException("Assignment not found.");
    }

    await Promise.all(
      languages.map(async (lang) => {
        try {
          const existingTranslation =
            await this.prisma.assignmentTranslation.findFirst({
              where: { assignmentId, languageCode: lang },
            });

          if (existingTranslation) {
            const updatedData: Prisma.AssignmentTranslationUpdateInput = {};
            const translationTasks = [];
            if (job) {
              await this.jobStatusService.updateJobStatus(
                job.id,
                `Updating assignment translation that is in ${getLanguageNameFromCode(
                  lang,
                )}`,
                "In Progress",
                null,
                60,
              );
            }
            if (
              assignment.name !== existingTranslation.name &&
              assignment.name
            ) {
              translationTasks.push(
                this.llmFacadeService
                  .translateText(assignment.name, lang, assignmentId)
                  .then(
                    (translated) => (updatedData.translatedName = translated),
                  ),
              );
            }
            if (
              assignment.instructions !== existingTranslation.instructions &&
              assignment.instructions
            ) {
              translationTasks.push(
                this.llmFacadeService
                  .translateText(assignment.instructions, lang, assignmentId)
                  .then(
                    (translated) =>
                      (updatedData.translatedInstructions = translated),
                  ),
              );
            }
            if (
              assignment.gradingCriteriaOverview !==
                existingTranslation.gradingCriteriaOverview &&
              assignment.gradingCriteriaOverview
            ) {
              translationTasks.push(
                this.llmFacadeService
                  .translateText(
                    assignment.gradingCriteriaOverview,
                    lang,
                    assignmentId,
                  )
                  .then(
                    (translated) =>
                      (updatedData.translatedGradingCriteriaOverview =
                        translated),
                  ),
              );
            }
            if (
              assignment.introduction !== existingTranslation.introduction &&
              assignment.introduction
            ) {
              translationTasks.push(
                this.llmFacadeService
                  .translateText(assignment.introduction, lang, assignmentId)
                  .then(
                    (translated) =>
                      (updatedData.translatedIntroduction = translated),
                  ),
              );
            }

            await Promise.all(translationTasks);
            if (assignment.name !== existingTranslation.name) {
              updatedData.name = assignment.name;
            }
            if (Object.keys(updatedData).length > 0) {
              await this.prisma.assignmentTranslation.update({
                where: { id: existingTranslation.id },
                data: updatedData,
              });
            }
          } else {
            if (job) {
              await this.jobStatusService.updateJobStatus(
                job.id,
                `Translating assignment to ${getLanguageNameFromCode(lang)}`,
                "In Progress",
                null,
                80,
              );
            }
            const [
              translatedName,
              translatedInstructions,
              translatedGradingCriteriaOverview,
              translatedIntroduction,
            ] = await Promise.all([
              this.llmFacadeService.translateText(
                assignment.name,
                lang,
                assignmentId,
              ),
              this.llmFacadeService.translateText(
                assignment.instructions,
                lang,
                assignmentId,
              ),
              this.llmFacadeService.translateText(
                assignment.gradingCriteriaOverview,
                lang,
                assignmentId,
              ),
              this.llmFacadeService.translateText(
                assignment.introduction,
                lang,
                assignmentId,
              ),
            ]);

            await this.prisma.assignmentTranslation.create({
              data: {
                assignment: { connect: { id: assignmentId } },
                languageCode: lang,
                name: assignment.name,
                translatedName,
                instructions: assignment.instructions,
                translatedInstructions,
                gradingCriteriaOverview: assignment.gradingCriteriaOverview,
                translatedGradingCriteriaOverview,
                introduction: assignment.introduction,
                translatedIntroduction,
              },
            });
          }
        } catch (error) {
          this.logger.error(
            `Failed to translate assignment ${assignmentId} to ${lang}`,
            error,
          );
        }
      }),
    );
  }

  /**
   * getQuestionInLanguage
   * - Retrieves a question and its translation (if available) for a given language.
   * - We assume no variantId, so we look up a translation row where variantId = null.
   */
  async getQuestionInLanguage(questionId: number, language: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException("Question not found.");

    const translation = await this.prisma.translation.findFirst({
      where: {
        questionId: questionId,
        variantId: null,
        languageCode: language,
      },
    });

    return {
      questionText: translation
        ? translation.translatedText
        : question.question,
      choices: translation?.translatedChoices
        ? (translation.translatedChoices as string as Prisma.JsonValue)
        : question.choices,
    };
  }
  async getAvailableLanguages(assignmentId: number) {
    const availableLanguages = new Set<string>();
    const assignmentTranslations =
      await this.prisma.assignmentTranslation.findMany({
        where: { assignmentId },
      });
    for (const translation of assignmentTranslations) {
      availableLanguages.add(translation.languageCode);
    }
    if (availableLanguages.size === 0) {
      availableLanguages.add("en");
    }
    return [...availableLanguages];
  }

  /**
   * getVariantInLanguage
   * - Retrieves a specific variant in the requested language.
   * - We look up using (questionId, variantId, languageCode) on the translations table.
   */
  async getVariantInLanguage(variantId: number, language: string) {
    const variant = await this.prisma.questionVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) throw new NotFoundException("Variant not found.");

    const translation = await this.prisma.translation.findFirst({
      where: {
        questionId: variant.questionId,
        variantId: variantId,
        languageCode: language,
      },
    });

    return {
      variantContent: translation
        ? translation.translatedText
        : variant.variantContent,
      choices: translation?.translatedChoices
        ? (translation.translatedChoices as string as unknown as Choice[])
        : variant.choices,
    };
  }

  async createReport(
    assignmentId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }

    const reports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });
    if (reports.length >= 5) {
      throw new UnprocessableEntityException(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    }

    await this.prisma.report.create({
      data: {
        assignmentId,
        issueType,
        description,
        reporterId: userId,
        author: true,
      },
    });
  }
  async generateVariantsFromQuestions(
    assignmentId: number,
    generateQuestionVariantDto: GenerateQuestionVariantDto,
  ): Promise<
    BaseAssignmentResponseDto & {
      questions?: QuestionDto[];
    }
  > {
    const { questions, questionVariationNumber } = generateQuestionVariantDto;

    await Promise.all(
      questions.map(async (question) => {
        if (question.variants === undefined) question.variants = [];
        if (
          (questions.length > 1 &&
            question.variants?.length < questionVariationNumber) ||
          questions.length === 1
        ) {
          let variantId = 1;
          const numberOfRequiredVariants =
            questions.length > 1
              ? questionVariationNumber - (question.variants?.length || 0)
              : questionVariationNumber;

          if (numberOfRequiredVariants <= 0) {
            return;
          }

          const newVariants = await this.generateVariantsFromQuestion(
            question,
            numberOfRequiredVariants,
          );
          if (Array.isArray(question.variants)) {
            question.variants.push(
              ...(newVariants.map((variant) => ({
                ...variant,
                questionId: question.id,
                id: Number(
                  `${question.id}${question.variants.length + variantId++}`,
                ),
                choices: variant.choices,
                scoring: variant.scoring,
                variantType: variant.variantType,
                randomizedChoices: true,
              })) as VariantDto[]),
            );
          } else {
            question.variants = newVariants.map((variant) => ({
              ...variant,
              choices: variant.choices,
              scoring: variant.scoring,
              id: Number(`${question.id}${variantId++}`),
              questionId: question.id,
              variantType: variant.variantType,
              randomizedChoices: true,
            })) as VariantDto[];
          }
        }
      }),
    );

    return {
      id: assignmentId,
      success: true,
      questions,
    };
  }

  private async generateVariantsFromQuestion(
    question: QuestionDto,
    numberOfVariants = 1,
  ): Promise<VariantDto[]> {
    try {
      if (!question) {
        throw new HttpException(
          "Question not found",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const variants = await this.llmFacadeService.generateQuestionRewordings(
        question.question,
        numberOfVariants,
        question.type,
        question.assignmentId,
        question.choices,
        question.variants,
      );
      const variantData = variants.map((variant) => ({
        id: variant.id,
        questionId: question.id,
        variantContent: variant.variantContent,
        choices: variant.choices,
        maxWords: question.maxWords,
        scoring: question.scoring,
        answer: question.answer,
        maxCharacters: question.maxCharacters,
        createdAt: new Date(),
        difficultyLevel: undefined,
        variantType: VariantType.REWORDED,
      }));
      return variantData;
    } catch {
      throw new HttpException(
        "Failed to generate and save reworded variants",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private createEmptyDto(): Partial<ReplaceAssignmentRequestDto> {
    return {
      instructions: undefined,
      numAttempts: undefined,
      attemptsBeforeCoolDown: undefined,
      retakeAttemptCoolDownMinutes: undefined,
      allotedTimeMinutes: undefined,
      attemptsPerTimeRange: undefined,
      attemptsTimeRangeHours: undefined,
      displayOrder: undefined,
    };
  }

  private async handleQuestionGradingContext(assignmentId: number) {
    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    })) as { questions: { id: number; question: string }[] } & {
      questionOrder: number[];
    };

    const assignmentData = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { questionOrder: true },
    });
    const questionsForGradingContext = applyQuestionOrder(
      assignment.questions,
      assignmentData?.questionOrder,
    ).map((q) => ({
      id: q.id,
      questionText: q.question,
    }));

    const questionGradingContextMap =
      await this.llmFacadeService.generateQuestionGradingContext(
        questionsForGradingContext,
        assignmentId,
      );

    const updates = [];

    for (const [questionId, gradingContextQuestionIds] of Object.entries(
      questionGradingContextMap,
    )) {
      updates.push(
        this.prisma.question.update({
          where: { id: Number.parseInt(questionId) },
          data: { gradingContextQuestionIds },
        }),
      );
    }

    await Promise.all(updates);
  }
}
