import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Job, Prisma, ReportType } from "@prisma/client";
import {
  UserRole,
  type UserSession,
} from "../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import type {
  BaseAssignmentResponseDto,
  UpdateAssignmentQuestionsResponseDto,
} from "./dto/base.assignment.response.dto";
import type {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";
import { QuestionsToGenerate } from "./dto/post.assignment.request.dto";
import type { ReplaceAssignmentRequestDto } from "./dto/replace.assignment.request.dto";
import type {
  AssignmentTypeEnum,
  UpdateAssignmentRequestDto,
} from "./dto/update.assignment.request.dto";
import {
  GenerateQuestionVariantDto,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
  VariantType,
} from "./dto/update.questions.request.dto";
import {
  CreateUpdateQuestionRequestDto,
  LLMResponseQuestion,
} from "./question/dto/create.update.question.request.dto";

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

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
  async findOne(
    id: number,
    userSession: UserSession,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const isLearner = userSession.role === UserRole.LEARNER;

    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        questions: {
          include: { variants: true },
        },
      },
    });

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
            } catch (error) {
              console.error("Error parsing choices:", error);
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
    // Start the job processing asynchronously
    setImmediate(() => {
      this.processJob(
        assignmentId,
        jobId,
        assignmentType,
        questionsToGenerate,
        files,
        learningObjectives,
      ).catch((error) => {
        console.error(`Error processing job ID ${jobId}:`, error);
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
        // Update progress
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            progress: "Mark is organizing the notes... merging file contents.",
          },
        });
        // Merge all file contents into a single string
        const mergedContent = files.map((file) => file.content).join("\n");

        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            progress:
              "Mark is proofreading the content... sanitizing material.",
          },
        });
        // Sanitize the merged content
        content = this.llmService.sanitizeContent(mergedContent);
      }
      // // Moderate the content
      // const moderationResult = await this.llmService.moderateContent(
      //   sanitizedContent,
      // );
      // if (moderationResult.flagged) {
      //   await this.prisma.job.update({
      //     where: { id: jobId },
      //     data: {
      //       status: 'Failed',
      //       progress: 'Content contains prohibited material',
      //     },
      //   });
      //   console.warn(`Job ID ${jobId} failed due to flagged content`);
      //   return;
      // }

      // await this.prisma.job.update({
      //   where: { id: jobId },
      //   data: {
      //     progress: 'Content passed moderation, processing with LLM...',
      //   },
      // });
      // Add message before LLM processing, which takes the longest
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          progress: "Mark is thinking... generating questions.",
        },
      });

      const llmResponse = (await this.llmService.processMergedContent(
        assignmentId,
        assignmentType,
        questionsToGenerate,
        content,
        learningObjectives,
      )) as LLMResponseQuestion[];

      // Update job status and store the generated questions
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: "Completed",
          progress:
            "Mark has prepared the questions. Job completed successfully.",
          result: JSON.stringify(llmResponse),
        },
      });
    } catch (error) {
      console.error(`Error processing job ID ${jobId}:`, error);

      // Update job status to 'Failed'
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
    if (updateAssignmentDto.published && updateAssignmentDto.questionOrder) {
      await this.handleQuestionGradingContext(
        id,
        updateAssignmentDto.questionOrder,
      );
    }

    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
    };
  }
  async publishAssignment(
    assignmentId: number,
    updateAssignmentQuestionsDto: UpdateAssignmentQuestionsDto,
  ): Promise<UpdateAssignmentQuestionsResponseDto> {
    const {
      introduction,
      instructions,
      gradingCriteriaOverview,
      numAttempts,
      passingGrade,
      displayOrder,
      graded,
      questionDisplay,
      allotedTimeMinutes,
      updatedAt,
      published,
      questions,
      showAssignmentScore,
      showQuestionScore,
      showSubmissionFeedback,
    } = updateAssignmentQuestionsDto;
    const updatedAtDate = updatedAt ? new Date(updatedAt) : new Date();

    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        introduction,
        instructions,
        gradingCriteriaOverview,
        numAttempts,
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
      },
    });
    if (
      !questions ||
      questions.length === 0 ||
      questions === undefined ||
      questions === null
    ) {
      return { id: assignmentId, success: true };
    }
    const existingQuestions = await this.prisma.question.findMany({
      where: { assignmentId },
      include: { variants: true },
    });

    const activeQuestions = existingQuestions.filter((q) => !q.isDeleted);

    const existingQuestionsMap = new Map<number, (typeof activeQuestions)[0]>();
    for (const q of activeQuestions) existingQuestionsMap.set(q.id, q);
    const newQuestionIds = new Set<number>(questions.map((q) => q.id));

    const questionsToDelete = activeQuestions.filter(
      (q) => !newQuestionIds.has(q.id),
    );

    if (questionsToDelete.length > 0) {
      await this.prisma.question.updateMany({
        where: { id: { in: questionsToDelete.map((q) => q.id) } },
        data: { isDeleted: true },
      });
    }

    const frontendToBackendIdMap = new Map<number, number>();

    await Promise.all(
      questions.map(async (question) => {
        const questionData: Prisma.QuestionUpsertArgs["create"] = {
          choices: question.choices
            ? (JSON.parse(
                JSON.stringify(question.choices),
              ) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          scoring: question.scoring
            ? (JSON.parse(
                JSON.stringify(question.scoring),
              ) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          answer: question.answer ?? false,
          type: question.type,
          totalPoints: question.totalPoints ?? 0,
          question: question.question,
          maxWords: question.maxWords,
          maxCharacters: question.maxCharacters,
          responseType: question.responseType,
          randomizedChoices: question.randomizedChoices,
          assignment: { connect: { id: assignmentId } },
        };
        // only if there is changes in the question content, apply guardrails
        if (
          existingQuestionsMap.get(question.id)?.question !== question.question
        ) {
          await this.applyGuardRails(
            questionData as unknown as CreateUpdateQuestionRequestDto,
          );
        }

        const upsertedQuestion = await this.prisma.question.upsert({
          where: { id: question.id || 0 },
          update: questionData,
          create: questionData,
        });

        frontendToBackendIdMap.set(question.id, upsertedQuestion.id);

        const existingVariants =
          existingQuestionsMap.get(upsertedQuestion.id)?.variants || [];

        const existingVariantsMap = new Map<
          string,
          (typeof existingVariants)[0]
        >();
        for (const v of existingVariants)
          existingVariantsMap.set(v.variantContent, v);

        const newVariantContents = new Set<string>(
          question.variants?.map((v) => v.variantContent),
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
        if (question.variants) {
          await Promise.all(
            question.variants
              .filter((variant) => {
                const existingVariant = existingVariantsMap.get(
                  variant.variantContent,
                );
                return !existingVariant?.isDeleted;
              })
              .map(async (variant) => {
                const existingVariant = existingVariantsMap.get(
                  variant.variantContent,
                );

                const variantData: Prisma.QuestionVariantCreateInput = {
                  variantContent: variant.variantContent,
                  choices: variant.choices
                    ? (JSON.parse(
                        JSON.stringify(variant.choices),
                      ) as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                  maxWords: variant.maxWords,
                  scoring: variant.scoring
                    ? (JSON.parse(
                        JSON.stringify(variant.scoring),
                      ) as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                  maxCharacters: variant.maxCharacters,
                  variantType: variant.variantType,
                  createdAt: new Date(),
                  randomizedChoices: variant.randomizedChoices,
                  variantOf: { connect: { id: upsertedQuestion.id } },
                };

                if (existingVariant) {
                  const contentChanged =
                    existingVariant.variantContent !== variant.variantContent;
                  const choicesChanged =
                    JSON.stringify(existingVariant.choices) !==
                    JSON.stringify(variant.choices);

                  if (contentChanged || choicesChanged) {
                    await this.prisma.questionVariant.update({
                      where: { id: existingVariant.id },
                      data: { isDeleted: true },
                    });

                    const existingDeletedVariant =
                      await this.prisma.questionVariant.findFirst({
                        where: {
                          variantOf: { id: upsertedQuestion.id },
                          variantContent: variant.variantContent,
                          isDeleted: true,
                        },
                      });
                    existingDeletedVariant
                      ? await this.prisma.questionVariant.update({
                          where: { id: existingDeletedVariant.id },
                          data: {
                            ...variantData,
                            isDeleted: false,
                          },
                        })
                      : await this.prisma.questionVariant.create({
                          data: variantData,
                        });
                  } else {
                    await this.prisma.questionVariant.update({
                      where: { id: existingVariant.id },
                      data: {
                        maxWords: variant.maxWords,
                        maxCharacters: variant.maxCharacters,
                        variantType: variant.variantType,
                        randomizedChoices: variant.randomizedChoices,
                        scoring: variant.scoring
                          ? (JSON.parse(
                              JSON.stringify(variant.scoring),
                            ) as Prisma.InputJsonValue)
                          : Prisma.JsonNull,
                      },
                    });
                  }
                } else {
                  await this.prisma.questionVariant.create({
                    data: variantData,
                  });
                }
              }),
          );
        }
      }),
    );

    const questionOrder = questions.map((q) => {
      const backendId = frontendToBackendIdMap.get(q.id);
      return backendId || q.id;
    });
    // Handle grading context
    await this.handleQuestionGradingContext(assignmentId, questionOrder);

    // Update assignment
    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { questionOrder, published: true },
    });
    const allQuestions = await this.prisma.question.findMany({
      where: { assignmentId, isDeleted: false },
      include: {
        variants: {
          where: { isDeleted: false },
        },
      },
    });
    allQuestions.sort(
      (a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id),
    );

    return { id: assignmentId, questions: allQuestions, success: true };
  }
  async createReport(
    assignmentId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    // Ensure the assignment exists
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }
    // if the user created more than 5 reports in the last 24 hours, throw an error
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

    // Create a new report
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
              : questionVariationNumber; // if the size of the question array is 1, we need to generate the number of variants specified in the request, if its more then it means we need to generate the difference between the number of variants and the number of variants already present in the question

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
      const variants = await this.llmService.generateQuestionRewordings(
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
    } catch (error) {
      console.error("Error generating and saving reworded variants:", error);
      throw new HttpException(
        "Failed to generate and save reworded variants",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // private methods
  private createEmptyDto(): Partial<ReplaceAssignmentRequestDto> {
    return {
      instructions: undefined,
      numAttempts: undefined,
      allotedTimeMinutes: undefined,
      attemptsPerTimeRange: undefined,
      attemptsTimeRangeHours: undefined,
      displayOrder: undefined,
    };
  }

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<void> {
    const guardRailsValidation = await this.llmService.applyGuardRails(
      JSON.stringify(createUpdateQuestionRequestDto),
    );
    if (!guardRailsValidation) {
      throw new HttpException(
        "Question validation failed due to inappropriate or unacceptable content",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async handleQuestionGradingContext(
    assignmentId: number,
    questionOrder: number[],
  ) {
    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    })) as { questions: { id: number; question: string }[] };

    const questionsForGradingContext = assignment.questions
      .sort((a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id))
      .map((q) => ({
        id: q.id,
        questionText: q.question,
      }));

    const questionGradingContextMap =
      await this.llmService.generateQuestionGradingContext(
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
