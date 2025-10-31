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
import { Job, Prisma, QuestionVariant, ReportType } from "@prisma/client";
import Bottleneck from "bottleneck";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";
import {
  getAllLanguageCodes,
  getLanguageNameFromCode,
} from "../../attempt/helper/languages";
import {
  BaseAssignmentResponseDto,
  UpdateAssignmentQuestionsResponseDto,
} from "../../dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import { QuestionsToGenerate } from "../../dto/post.assignment.request.dto";
import { ReplaceAssignmentRequestDto } from "../../dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "../../dto/update.assignment.request.dto";
import {
  Choice,
  GenerateQuestionVariantDto,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
  VariantType,
} from "../../dto/update.questions.request.dto";
import {
  CreateUpdateQuestionRequestDto,
  LLMResponseQuestion,
} from "../../question/dto/create.update.question.request.dto";

interface PublishingStep {
  name: string;
  targetPercentage: number;
  shouldRun: () => boolean;
  run: () => Promise<void>;
}

@Injectable()
export class AssignmentServiceV1 {
  private logger: Logger;
  private languageTranslation: boolean;
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV1,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "AssignmentServiceV1" });
    this.languageTranslation =
      process.env.NODE_ENV === "development" ? false : true;
  }
  async createJob(assignmentId: number, userId: string): Promise<Job> {
    return await this.prisma.job.create({
      data: {
        assignmentId,
        userId,
        status: "Pending",
        progress: "Job created",
      },
    });
  }

  async getJobStatus(jobId: number): Promise<Job> {
    return await this.prisma.job.findUnique({
      where: { id: jobId },
    });
  }

  async getPublishJobStatus(jobId: number): Promise<Job> {
    return await this.prisma.publishJob.findUnique({
      where: { id: Number(jobId) },
    });
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
    if (result.questions && result.questionOrder) {
      result.questions.sort(
        (a, b) =>
          result.questionOrder.indexOf(a.id) -
          result.questionOrder.indexOf(b.id),
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

      return authoredAssignments;
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
    }));
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
    jobId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    setImmediate(() => {
      this.processJob(
        assignmentId,
        jobId,
        assignmentType,
        questionsToGenerate,
        files,
        learningObjectives,
      ).catch((error) => {
        this.logger.error(
          `Error processing job ID ${jobId}: ${(error as Error).message}`,
        );
      });
    });
  }
  private async processJob(
    assignmentId: number,
    jobId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    try {
      let content = "";
      if (files) {
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            progress: "Mark is organizing the notes merging file contents.",
          },
        });

        const mergedContent = files.map((file) => file.content).join("\n");

        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            progress: "Mark is proofreading the content sanitizing material.",
          },
        });

        content = this.llmFacadeService.sanitizeContent(mergedContent);
      }

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          progress: "Mark is thinking generating questions.",
        },
      });

      const llmResponse = (await this.llmFacadeService.processMergedContent(
        assignmentId,
        assignmentType,
        questionsToGenerate,
        content,
        learningObjectives,
      )) as LLMResponseQuestion[];

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: "Completed",
          progress:
            "Mark has prepared the questions. Job completed successfully.",
          result: JSON.stringify(llmResponse),
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Error processing job ID ${jobId}: ${(error as Error).message}`,
      );

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: "Failed",
          progress: "Mark hit a snag, we are sorry for the inconvenience",
        },
      });
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

  async updateJobStatus(
    job: Job,
    progress: string,
    status = "In Progress",
    result?: unknown,
    percentage?: number,
  ): Promise<void> {
    await this.prisma.publishJob.update({
      where: { id: job.id },
      data: {
        progress,
        status,
        percentage,
        result: result ? JSON.stringify(result) : undefined,
        updatedAt: new Date(),
      },
    });

    this.jobStatusService.updateJobStatus(
      job.id,
      progress,
      status,
      result,
      percentage,
    );
  }

  async publishAssignment(
    assignmentId: number,
    updateAssignmentQuestionsDto: UpdateAssignmentQuestionsDto,
    userId: string,
  ): Promise<{ jobId: number; message: string }> {
    const job = await this.prisma.publishJob.create({
      data: {
        assignmentId,
        userId,
        status: "In Progress",
        progress: "Initializing assignment publishing...",
      },
    });
    this.processPublishingJob(
      job.id,
      assignmentId,
      updateAssignmentQuestionsDto,
      userId,
    ).catch((error) => {
      this.logger.error(
        `Error processing publishing job: ${(error as Error).message}`,
      );
    });

    return { jobId: job.id, message: "Publishing started." };
  }

  /**
   * publishAssignment
   * - Updates assignment settings (title, instructions, etc.)
   * - Handles creation/updating/deletion of questions & variants
   * - Applies translations only for changed questions/variants, skipping if it already exists
   * - Ensures (questionId, variantId) is always captured in translations
   */
  /**
   * publishAssignment
   * - Updates assignment settings (title, instructions, etc.)
   * - Handles creation/updating/deletion of questions & variants
   * - Applies translations only for changed questions/variants, skipping if it already exists
   * - Ensures (questionId, variantId) is always captured in translations
   */
  private async processPublishingJob(
    jobId: number,
    assignmentId: number,
    updateAssignmentQuestionsDto: UpdateAssignmentQuestionsDto,
    userId: string,
  ): Promise<{ jobId: number; message: string }> {
    const {
      introduction,
      instructions,
      gradingCriteriaOverview,
      numAttempts,
      attemptsBeforeCoolDown,
      retakeAttemptCoolDownMinutes,
      passingGrade,
      displayOrder,
      graded,
      questionDisplay,
      allotedTimeMinutes,
      timeEstimateMinutes,
      updatedAt,
      published,
      questions,
      showAssignmentScore,
      showQuestionScore,
      showSubmissionFeedback,
      showQuestions,
    } = updateAssignmentQuestionsDto;
    const supportedLanguages = this.languageTranslation
      ? getAllLanguageCodes()
      : ["en"];

    const safeQuestions = questions ?? [];

    if (!introduction) {
      this.logger.error(
        `Introduction not provided for assignment: ${assignmentId}`,
      );
      throw new UnprocessableEntityException("Introduction not provided.");
    }

    const job = await this.prisma.publishJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      this.logger.error(`Job not found: ${jobId}`);
      throw new Error("Job not found");
    }

    const frontendToBackendIdMap = new Map<number, number>();

    const totalQuestionTranslations = safeQuestions.reduce(
      (accumulator, question) => accumulator + supportedLanguages.length,
      0,
    );
    let totalVariantTranslations = 0;
    for (const question of safeQuestions) {
      const variantCount = question.variants ? question.variants.length : 0;
      totalVariantTranslations += variantCount * supportedLanguages.length;
    }
    const totalTranslationTasks =
      totalQuestionTranslations + totalVariantTranslations;
    const translationBasePercentage = 20;
    const translationRange = 40;
    let completedTranslations = 0;
    let currentTranslationProgress = translationBasePercentage;

    function updateTranslationProgress(): number {
      completedTranslations++;
      const calculatedProgress =
        translationBasePercentage +
        Math.floor(
          (completedTranslations / totalTranslationTasks) * translationRange,
        );
      if (calculatedProgress > currentTranslationProgress) {
        currentTranslationProgress = calculatedProgress;
      }
      return currentTranslationProgress;
    }

    interface PublishingStep {
      name: string;
      targetPercentage: number;
      shouldRun: () => boolean;
      run: () => Promise<void>;
    }

    const steps: PublishingStep[] = [
      {
        name: "Updating assignment settings",
        targetPercentage: 10,
        shouldRun: () => true,
        run: async () => {
          await this.updateJobStatus(
            job,
            "Updating assignment settings",
            "In Progress",
            null,
            10,
          );
          const updatedAtDate = updatedAt ? new Date(updatedAt) : new Date();
          const languageCode =
            (await this.llmFacadeService.getLanguageCode(introduction)) || "en";
          await this.prisma.assignment.update({
            where: { id: assignmentId },
            data: {
              introduction,
              instructions,
              gradingCriteriaOverview,
              numAttempts,
              attemptsBeforeCoolDown,
              retakeAttemptCoolDownMinutes,
              passingGrade,
              displayOrder,
              graded,
              questionDisplay,
              allotedTimeMinutes,
              updatedAt: updatedAtDate,
              published,
              showAssignmentScore,
              showQuestionScore,
              showSubmissionFeedback,
              languageCode,
              timeEstimateMinutes,
              showQuestions,
            },
          });

          try {
            const existingAuthor = await this.prisma.assignmentAuthor.findFirst(
              {
                where: {
                  assignmentId,
                  userId,
                },
              },
            );

            if (!existingAuthor) {
              await this.prisma.assignmentAuthor.create({
                data: {
                  assignmentId,
                  userId,
                },
              });
            }
          } catch (error) {
            this.logger.warn(
              `Failed to store assignment author: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          }
        },
      },
      {
        name: "Processing questions",
        targetPercentage: 20,
        shouldRun: () => safeQuestions.length > 0,
        run: async () => {
          const existingQuestions = await this.prisma.question.findMany({
            where: { assignmentId },
            include: { variants: true },
          });
          const activeQuestions = existingQuestions.filter((q) => !q.isDeleted);
          const existingQuestionsMap = new Map<
            number,
            (typeof activeQuestions)[0]
          >();
          for (const q of activeQuestions) {
            existingQuestionsMap.set(q.id, q);
          }

          const newQuestionIds = new Set<number>(
            safeQuestions.map((q) => q.id),
          );
          const questionsToDelete = activeQuestions.filter(
            (q) => !newQuestionIds.has(q.id),
          );
          if (questionsToDelete.length > 0) {
            await this.prisma.question.updateMany({
              where: { id: { in: questionsToDelete.map((q) => q.id) } },
              data: { isDeleted: true },
            });
          }

          await Promise.all(
            safeQuestions.map(async (questionDto) => {
              const backendId =
                frontendToBackendIdMap.get(questionDto.id) || questionDto.id;
              const existingQuestion = existingQuestionsMap.get(backendId);

              const questionData: Prisma.QuestionUpsertArgs["create"] = {
                question: questionDto.question,
                type: questionDto.type,
                answer: questionDto.answer ?? false,
                totalPoints: questionDto.totalPoints ?? 0,
                choices: questionDto.choices
                  ? (JSON.parse(
                      JSON.stringify(questionDto.choices),
                    ) as Prisma.JsonValue)
                  : Prisma.JsonNull,
                scoring: questionDto.scoring
                  ? (JSON.parse(
                      JSON.stringify(questionDto.scoring),
                    ) as Prisma.JsonValue)
                  : Prisma.JsonNull,
                maxWords: questionDto.maxWords,
                maxCharacters: questionDto.maxCharacters,
                responseType: questionDto.responseType,
                randomizedChoices: questionDto.randomizedChoices,
                liveRecordingConfig: questionDto?.liveRecordingConfig,
                videoPresentationConfig: questionDto?.videoPresentationConfig
                  ? (JSON.parse(
                      JSON.stringify(questionDto.videoPresentationConfig),
                    ) as Prisma.JsonValue)
                  : Prisma.JsonNull,
                assignment: { connect: { id: assignmentId } },
              };

              if (
                existingQuestion &&
                existingQuestion.question !== questionDto.question
              ) {
                await this.applyGuardRails(
                  questionData as unknown as CreateUpdateQuestionRequestDto,
                );
              }

              const upsertedQuestion = await this.prisma.question.upsert({
                where: {
                  id: existingQuestion ? existingQuestion.id : questionDto.id,
                },
                update: questionData,
                create: questionData,
              });

              if (!existingQuestion) {
                frontendToBackendIdMap.set(questionDto.id, upsertedQuestion.id);
              }

              await this.handleQuestionTranslations(
                job,
                assignmentId,
                upsertedQuestion.id,
                questionDto,
                supportedLanguages,
                updateTranslationProgress,
              );

              const existingVariants = existingQuestion?.variants || [];
              const existingVariantsMap = new Map<
                string,
                (typeof existingVariants)[0]
              >();
              for (const v of existingVariants) {
                existingVariantsMap.set(v.variantContent, v);
              }

              const newVariantContents = new Set(
                questionDto.variants?.map((v) => v.variantContent) ?? [],
              );
              const variantsToDelete = existingVariants.filter(
                (v) => !newVariantContents.has(v.variantContent),
              );
              if (variantsToDelete.length > 0) {
                await this.prisma.questionVariant.updateMany({
                  where: { id: { in: variantsToDelete.map((v) => v.id) } },
                  data: { isDeleted: true },
                });
              }

              if (questionDto.variants) {
                await Promise.all(
                  questionDto.variants.map(async (variantDto) => {
                    const existingVariant = existingVariantsMap.get(
                      variantDto.variantContent,
                    );
                    const variantData: Prisma.QuestionVariantCreateInput = {
                      variantContent: variantDto.variantContent,
                      choices: variantDto.choices
                        ? (JSON.parse(
                            JSON.stringify(variantDto.choices),
                          ) as Prisma.JsonValue)
                        : Prisma.JsonNull,
                      scoring: variantDto.scoring
                        ? (JSON.parse(
                            JSON.stringify(variantDto.scoring),
                          ) as Prisma.JsonValue)
                        : Prisma.JsonNull,
                      maxWords: variantDto.maxWords,
                      maxCharacters: variantDto.maxCharacters,
                      randomizedChoices: variantDto.randomizedChoices,
                      variantType: variantDto.variantType,
                      createdAt: new Date(),
                      variantOf: { connect: { id: upsertedQuestion.id } },
                    };
                    if (existingVariant) {
                      const updatedVariant =
                        await this.prisma.questionVariant.update({
                          where: { id: existingVariant.id },
                          data: variantData,
                        });
                      await this.handleVariantTranslations(
                        job,
                        assignmentId,
                        upsertedQuestion.id,
                        updatedVariant,
                        supportedLanguages,
                        updateTranslationProgress,
                      );
                    } else {
                      const newVariant =
                        await this.prisma.questionVariant.create({
                          data: variantData,
                        });
                      await this.handleVariantTranslations(
                        job,
                        assignmentId,
                        upsertedQuestion.id,
                        newVariant,
                        supportedLanguages,
                        updateTranslationProgress,
                      );
                    }
                  }),
                );
              }
            }),
          );
        },
      },
      {
        name: "Translating assignment information",
        targetPercentage: 70,
        shouldRun: () => true,
        run: async () => {
          await this.updateJobStatus(
            job,
            "Starting to translate assignment information",
            "In Progress",
            null,
            40,
          );
          await this.handleAssignmentTranslations(
            assignmentId,
            supportedLanguages,
            job,
          );
        },
      },
      {
        name: "Finalizing publishing",
        targetPercentage: 90,
        shouldRun: () => true,
        run: async () => {
          await this.updateJobStatus(
            job,
            "Finalizing and marking assignment as published...",
            "In Progress",
            null,
            90,
          );
          const questionOrder = safeQuestions.map((q) => {
            const backendId = frontendToBackendIdMap.get(q.id);
            return backendId || q.id;
          });
          await this.handleQuestionGradingContext(assignmentId);
          await this.prisma.assignment.update({
            where: { id: assignmentId },
            data: {
              questionOrder,
              published: true,
            },
          });
        },
      },
    ];

    try {
      for (const step of steps) {
        if (!step.shouldRun()) {
          await this.updateJobStatus(
            job,
            `${step.name} skipped`,
            "In Progress",
            null,
            step.targetPercentage,
          );
          continue;
        }
        await this.updateJobStatus(
          job,
          `Starting: ${step.name}`,
          "In Progress",
          null,
          step.targetPercentage * 0.8,
        );
        try {
          await step.run();
          await this.updateJobStatus(
            job,
            `${step.name} completed`,
            "In Progress",
            null,
            step.targetPercentage,
          );
        } catch (error) {
          await this.updateJobStatus(
            job,
            `Error during ${step.name}: ${(error as Error).message}`,
            "Failed",
            null,
            step.targetPercentage,
          );
          throw error;
        }
      }

      const allQuestions = await this.prisma.question.findMany({
        where: { assignmentId, isDeleted: false },
        include: { variants: { where: { isDeleted: false } } },
      });
      const questionOrder = safeQuestions.map((q) => {
        const backendId = frontendToBackendIdMap.get(q.id);
        return backendId || q.id;
      });
      allQuestions.sort(
        (a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id),
      );

      const responseData: UpdateAssignmentQuestionsResponseDto = {
        id: assignmentId,
        success: true,
        questions: allQuestions.map((q) => {
          const variants = q.variants.map((v) => {
            const choices = (v.choices as unknown as Choice[]) ?? [];
            return { ...v, choices };
          });
          return { ...q, variants };
        }),
      };

      await this.updateJobStatus(
        job,
        "Publishing completed successfully!",
        "Completed",
        responseData,
        100,
      );
      return { jobId: job.id, message: "Assignment published successfully." };
    } catch (error) {
      this.logger.error(
        `Error publishing assignment: ${(error as Error).message}`,
      );
      const errorResponse: UpdateAssignmentQuestionsResponseDto = {
        id: assignmentId,
        success: false,
        error: (error as Error).message,
      };
      await this.updateJobStatus(
        job,
        `Error: ${(error as Error).message}`,
        "Failed",
        errorResponse,
      );
      throw new HttpException(
        "Failed to publish assignment.",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async handleAssignmentTranslations(
    assignmentId: number,
    languages: string[],
    job?: Job,
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
              await this.updateJobStatus(
                job,
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
              await this.updateJobStatus(
                job,
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
   * handleQuestionTranslations
   * - Stores the translation for a question with questionId, variantId = null.
   * - If question text or choices changed, or we don't have an existing translation, we generate/reuse it.
   * - If there's a variantId, we do not call this method; we use handleVariantTranslations instead.
   */
  private async handleQuestionTranslations(
    job: Job,
    assignmentId: number,
    questionId: number,
    question: UpdateAssignmentQuestionsDto["questions"][number],
    languages: string[],
    updateTranslationProgress: () => number,
  ): Promise<void> {
    const normalizedText = question.question.trim();
    const normalizedChoices = question.choices ?? null;
    const questionLang =
      (await this.llmFacadeService.getLanguageCode(normalizedText)) ||
      "unknown";

    const limiter = new Bottleneck({ maxConcurrent: 10 });

    await Promise.all(
      languages.map((lang) =>
        limiter.schedule(async () => {
          await this.updateJobStatus(
            job,
            `Translating Question #${questionId} to ${getLanguageNameFromCode(
              lang,
            )}`,
            "In Progress",
            null,
            updateTranslationProgress(),
          );

          if (questionLang === "unknown") {
            this.logger.warn(
              `Skipping translation for Q#${questionId} to ${lang}; unknown source.`,
            );
            return;
          }

          const existingReusable = await this.prisma.translation.findFirst({
            where: {
              languageCode: lang,
              untranslatedText: normalizedText,
              untranslatedChoices: {
                equals: normalizedChoices,
              } as unknown as Prisma.JsonNullableFilter,
            },
          });

          if (existingReusable) {
            const existingForThisQuestion =
              await this.prisma.translation.findFirst({
                where: {
                  questionId: questionId,
                  variantId: null,
                  languageCode: lang,
                  untranslatedText: normalizedText,
                  untranslatedChoices: {
                    equals: normalizedChoices,
                  } as unknown as Prisma.JsonNullableFilter,
                },
              });
            if (!existingForThisQuestion) {
              await this.prisma.translation.create({
                data: {
                  questionId: questionId,
                  variantId: null,
                  languageCode: lang,

                  untranslatedText: normalizedText,
                  untranslatedChoices: JSON.parse(
                    JSON.stringify(normalizedChoices),
                  ) as Prisma.JsonValue,

                  translatedText: existingReusable.translatedText,
                  translatedChoices:
                    existingReusable.translatedChoices ?? Prisma.JsonNull,
                },
              });
            }
            return;
          }

          let translatedText = normalizedText;
          let translatedChoices: Prisma.JsonValue | null = null;

          if (questionLang.toLowerCase() === lang.toLowerCase()) {
            translatedChoices = JSON.parse(
              JSON.stringify(normalizedChoices),
            ) as Prisma.JsonValue;
          } else {
            translatedText =
              await this.llmFacadeService.generateQuestionTranslation(
                assignmentId,
                normalizedText,
                lang,
              );

            if (normalizedChoices) {
              translatedChoices =
                (await this.llmFacadeService.generateChoicesTranslation(
                  normalizedChoices,
                  assignmentId,
                  lang,
                )) as unknown as Prisma.JsonValue;
            }
          }

          await this.prisma.translation.create({
            data: {
              questionId: questionId,
              variantId: null,
              languageCode: lang,

              untranslatedText: normalizedText,
              untranslatedChoices: JSON.parse(
                JSON.stringify(normalizedChoices),
              ) as Prisma.JsonValue,

              translatedText: translatedText,
              translatedChoices: translatedChoices ?? Prisma.JsonNull,
            },
          });
        }),
      ),
    );
  }

  /**
   * handleVariantTranslations
   * - For a given variant, we store a translation row with both questionId and variantId.
   * - If there's an existing translation for (questionId, variantId, languageCode), we skip.
   * - Reuses an existing variant’s translation if the text matches, else calls LLM.
   */
  private async handleVariantTranslations(
    job: Job,
    assignmentId: number,
    questionId: number,
    variant: QuestionVariant,
    languages: string[],
    updateTranslationProgress: () => number,
  ): Promise<void> {
    const normalizedText = variant.variantContent.trim();

    const normalizedChoices = variant.choices ?? null;

    const variantLang =
      (await this.llmFacadeService.getLanguageCode(normalizedText)) ||
      "unknown";

    const limiter = new Bottleneck({ maxConcurrent: 10 });

    await Promise.all(
      languages.map((lang) =>
        limiter.schedule(async () => {
          await this.updateJobStatus(
            job,
            `Translating variant #${variant.id} of Q#${questionId} to ${lang}`,
            "In Progress",
            null,
            updateTranslationProgress(),
          );

          if (variantLang === "unknown") {
            this.logger.warn(
              `Variant #${variant.id} has unknown language; skipping translation to ${lang}.`,
            );
            return;
          }
          const existingReusableTranslation =
            await this.prisma.translation.findFirst({
              where: {
                languageCode: lang,
                untranslatedText: normalizedText,
                untranslatedChoices: {
                  equals: normalizedChoices,
                } as Prisma.JsonNullableFilter,
              },
            });

          if (existingReusableTranslation) {
            const existingForThisVariant =
              await this.prisma.translation.findFirst({
                where: {
                  questionId: variant.questionId,
                  variantId: variant.id,
                  languageCode: lang,
                  untranslatedText: normalizedText,
                  untranslatedChoices: {
                    equals: normalizedChoices,
                  } as Prisma.JsonNullableFilter,
                },
              });

            if (!existingForThisVariant) {
              await this.prisma.translation.create({
                data: {
                  questionId: variant.questionId,
                  variantId: variant.id,
                  languageCode: lang,

                  untranslatedText: normalizedText,
                  untranslatedChoices: normalizedChoices,

                  translatedText: existingReusableTranslation.translatedText,
                  translatedChoices:
                    existingReusableTranslation.translatedChoices ??
                    Prisma.JsonNull,
                },
              });
            }

            return;
          }

          let translatedText = normalizedText;
          let translatedChoices: Prisma.JsonValue | null = null;

          if (variantLang.toLowerCase() === lang.toLowerCase()) {
            translatedChoices = normalizedChoices;
          } else {
            translatedText =
              await this.llmFacadeService.generateQuestionTranslation(
                assignmentId,
                normalizedText,
                lang,
              );

            if (normalizedChoices) {
              translatedChoices =
                (await this.llmFacadeService.generateChoicesTranslation(
                  normalizedChoices as unknown as Choice[],
                  assignmentId,
                  lang,
                )) as unknown as Prisma.JsonValue;
            }
          }

          await this.prisma.translation.create({
            data: {
              questionId: variant.questionId,
              variantId: variant.id,
              languageCode: lang,
              untranslatedText: normalizedText,
              untranslatedChoices: normalizedChoices,
              translatedText: translatedText,
              translatedChoices: translatedChoices ?? Prisma.JsonNull,
            },
          });
        }),
      ),
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

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<void> {
    const guardRailsValidation = await this.llmFacadeService.applyGuardRails(
      JSON.stringify(createUpdateQuestionRequestDto),
    );
    if (!guardRailsValidation) {
      throw new HttpException(
        "Question validation failed due to inappropriate or unacceptable content",
        HttpStatus.BAD_REQUEST,
      );
    }
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
    const questionOrder = assignmentData?.questionOrder || [];
    const questionsForGradingContext = assignment.questions
      .sort((a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id))
      .map((q) => ({
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
