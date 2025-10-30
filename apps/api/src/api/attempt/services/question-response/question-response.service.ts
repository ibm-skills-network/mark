/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import axios from "axios";
import * as cheerio from "cheerio";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { authorAssignmentDetailsDTO } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
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

@Injectable()
export class QuestionResponseService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionService: QuestionService,
    private readonly localizationService: LocalizationService,
    private readonly gradingFactoryService: GradingFactoryService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: QuestionResponseService.name,
    });
  }

  /**
   * Submit all questions for an assignment attempt
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
    const questionResponsesPromise = responsesForQuestions.map(
      async (questionResponse) => {
        return await this.createQuestionResponse(
          assignmentAttemptId,
          questionResponse,
          role,
          assignmentId,
          language,
          authorQuestions,
          assignmentDetails,
          preTranslatedQuestions,
        );
      },
    );

    const questionResponses = await Promise.allSettled(
      questionResponsesPromise,
    );

    const successfulResponses = questionResponses
      .filter((response) => response.status === "fulfilled")
      .map((response) => response.value);

    const failedResponses = questionResponses
      .filter(
        (response): response is PromiseRejectedResult =>
          response.status === "rejected",
      )
      .map((response) => {
        if (typeof response.reason === "string") {
          return response.reason;
        } else if (response.reason instanceof Error) {
          return response.reason.message;
        } else {
          return JSON.stringify(response.reason);
        }
      });

    if (failedResponses.length > 0) {
      throw new BadRequestException(
        `Failed to process some question responses: ${failedResponses.join(
          ", ",
        )}`,
      );
    }

    return successfulResponses;
  }

  /**
   * Create a question response
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

    if (this.isEmptyResponse(createQuestionResponseAttemptRequestDto)) {
      const { responseDto, learnerResponse } =
        this.handleEmptyResponse(language);

      if (role !== UserRole.AUTHOR) {
        await this.saveResponseToDatabase(
          assignmentAttemptId,
          questionId,
          learnerResponse,
          responseDto,
          role,
        );
      }

      responseDto.questionId = questionId;
      responseDto.question = question.question;

      return responseDto;
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
    let learnerResponse;

    try {
      if (question.type === QuestionType.LINK_FILE) {
        ({ responseDto, learnerResponse } = await this.handleLinkFileQuestion(
          question,
          createQuestionResponseAttemptRequestDto,
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
          createQuestionResponseAttemptRequestDto,
        );

        if (!isValid) {
          this.logger.warn("Response validation failed", {
            questionId,
            language: createQuestionResponseAttemptRequestDto.language,
            strategyName: gradingStrategy.constructor.name,
          });
          throw new BadRequestException(
            `Invalid response for question ID ${questionId}: ${createQuestionResponseAttemptRequestDto.language}`,
          );
        }

        this.logger.debug("Extracting learner response", { questionId });
        learnerResponse = await gradingStrategy.extractLearnerResponse(
          createQuestionResponseAttemptRequestDto,
        );

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

    if (role !== UserRole.AUTHOR) {
      await this.saveResponseToDatabase(
        assignmentAttemptId,
        questionId,
        learnerResponse,
        responseDto,
        role,
      );
    }

    responseDto.questionId = questionId;
    responseDto.question = question.question;

    return responseDto;
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
      const fileGradingStrategy = this.gradingFactoryService.getStrategy(
        QuestionType.UPLOAD,
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
  ): Promise<void> {
    try {
      const result = await this.prisma.questionResponse.create({
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
  ): Promise<{
    question: QuestionDto;
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
  }> {
    if (preTranslatedQuestions && preTranslatedQuestions.has(questionId)) {
      const question = preTranslatedQuestions.get(questionId);
      const assignmentContext = await this.getAssignmentContext(
        assignmentId,
        questionId,
        assignmentAttemptId,
      );
      return { question, assignmentContext };
    }

    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
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
        id: variant.id,
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
      question = await this.questionService.findOne(questionId);
    }

    const assignmentContext = await this.getAssignmentContext(
      assignmentId,
      questionId,
      assignmentAttemptId,
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
   * Get assignment context for grading
   */
  private async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { instructions: true },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found.`,
      );
    }

    const question = await this.prisma.question.findUnique({
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

    const contextQuestions = await this.prisma.question.findMany({
      where: {
        id: {
          in: question.gradingContextQuestionIds,
        },
      },
      select: { id: true, question: true, type: true },
    });

    const questionResponses = await this.prisma.questionResponse.findMany({
      where: {
        assignmentAttemptId: assignmentAttemptId,
        questionId: {
          in: question.gradingContextQuestionIds,
        },
      },
      orderBy: {
        id: "desc",
      },
    });

    const responsesByQuestionId: Record<number, any> = {};
    for (const response of questionResponses) {
      if (!responsesByQuestionId[response.questionId]) {
        responsesByQuestionId[response.questionId] = response;
      }
    }

    const questionAnswerContext = await Promise.all(
      contextQuestions.map(async (contextQuestion) => {
        const response = responsesByQuestionId[contextQuestion.id];
        let learnerResponse = response?.learnerResponse || "";

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
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `Error fetching URL content for question ${contextQuestion.id}: ${errorMessage}`,
            );
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
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error parsing JSON field: ${errorMessage}`);
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
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error("Error fetching URL content:", errorMessage);
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
