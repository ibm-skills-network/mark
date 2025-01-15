import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Assignment,
  Question,
  QuestionType,
  RegradingStatus,
  ReportType,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { QuestionAnswerContext } from "../../../api/llm/model/base.question.evaluate.model";
import { UrlBasedQuestionEvaluateModel } from "../../../api/llm/model/url.based.question.evaluate.model";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { FileUploadQuestionEvaluateModel } from "../../llm/model/file.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { AssignmentService } from "../assignment.service";
import type { LearnerGetAssignmentResponseDto } from "../dto/get.assignment.response.dto";
import { QuestionDto } from "../dto/update.questions.request.dto";
import {
  Choice,
  Scoring,
} from "../question/dto/create.update.question.request.dto";
import { QuestionService } from "../question/question.service";
import {
  GRADE_SUBMISSION_EXCEPTION,
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "./dto/assignment-attempt/base.assignment.attempt.response.dto";
import {
  authorAssignmentDetailsDTO,
  LearnerUpdateAssignmentAttemptRequestDto,
} from "./dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
  RegradingRequestDto,
  RegradingStatusResponseDto,
  RequestRegradingResponseDto,
} from "./dto/assignment-attempt/feedback.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import type { AssignmentAttemptQuestions } from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import { LearnerFileUpload } from "./dto/assignment-attempt/types";
import { UpdateAssignmentAttemptResponseDto } from "./dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
} from "./dto/question-response/create.question.response.attempt.response.dto";
import type { GetQuestionResponseAttemptResponseDto } from "./dto/question-response/get.question.response.attempt.response.dto";
import { AttemptHelper } from "./helper/attempts.helper";

//types
type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
  assignmentAttemptId?: number;
  learnerResponse?: string;
  points: number;
  feedback: object;
};

interface AssignmentAttempt {
  id: number;
  assignmentId: number;
  userId: string;
  expiresAt: Date | null;
  submitted: boolean;
  grade: number | null;
  attemptQuestionIds: number[];
  questionResponses: {
    id: number;
    questionId: number;
    assignmentAttemptId: number;
    feedback: JsonValue;
    learnerResponse: string;
    points: number;
  }[];
  questionVariants: {
    questionVariant: {
      id: number;
      variantContent: string;
      choices: JsonValue;
      maxWords: number;
      maxCharacters: number;
      scoring: JsonValue;
      answer: string;
    };
  }[];
}

@Injectable()
export class AttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService,
    private readonly httpService: HttpService,
  ) {}

  async submitFeedback(
    assignmentId: number,
    attemptId: number,
    feedbackDto: AssignmentFeedbackDto,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to submit feedback for this attempt.",
      );
    }

    const existingFeedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (existingFeedback) {
      const updatedFeedback = await this.prisma.assignmentFeedback.update({
        where: { id: existingFeedback.id },
        data: {
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        id: updatedFeedback.id,
      };
    } else {
      const feedback = await this.prisma.assignmentFeedback.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
        },
      });
      return {
        success: true,
        id: feedback.id,
      };
    }
  }
  async getFeedback(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackDto> {
    const feedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (!feedback) {
      return {
        comments: "",
        aiGradingRating: undefined,
        assignmentRating: undefined,
      };
    }

    return {
      comments: feedback.comments,
      aiGradingRating: feedback.aiGradingRating,
      assignmentRating: feedback.assignmentRating,
    };
  }
  async processRegradingRequest(
    assignmentId: number,
    attemptId: number,
    regradingRequestDto: RegradingRequestDto,
    userSession: UserSession,
  ): Promise<RequestRegradingResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to request regrading for this attempt.",
      );
    }

    const existingRegradingRequest =
      await this.prisma.assignmentFeedback.findFirst({
        where: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
        },
      });

    if (existingRegradingRequest) {
      const updatedRegradingRequest = await this.prisma.regradingRequest.update(
        {
          where: { id: existingRegradingRequest.id },
          data: {
            regradingReason: regradingRequestDto.reason,
            regradingStatus: RegradingStatus.PENDING,
            updatedAt: new Date(),
          },
        },
      );

      return {
        success: true,
        id: updatedRegradingRequest.id,
      };
    } else {
      const regradingRequest = await this.prisma.regradingRequest.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          regradingReason: regradingRequestDto.reason,
          regradingStatus: RegradingStatus.PENDING,
        },
      });
      return {
        success: true,
        id: regradingRequest.id,
      };
    }
  }
  async getRegradingStatus(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<RegradingStatusResponseDto> {
    const regradingRequest = await this.prisma.regradingRequest.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (!regradingRequest) {
      throw new NotFoundException(
        `Regrading request for assignment ${assignmentId} and attempt ${attemptId} not found.`,
      );
    }

    return {
      status: regradingRequest.regradingStatus,
    };
  }

  /**
   * Lists assignment attempts for the given assignment and user session.
   * @param assignmentId The ID of the assignment.
   * @param userSession The user session.
   * @returns A list of assignment attempt response DTOs.
   */
  async listAssignmentAttempts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<AssignmentAttemptResponseDto[]> {
    const { userId, role } = userSession;

    // Correct ownership permissions are handled through AssignmentAttemptAccessControlGuard.
    return role === UserRole.AUTHOR
      ? this.prisma.assignmentAttempt.findMany({
          where: { assignmentId },
        })
      : this.prisma.assignmentAttempt.findMany({
          where: { assignmentId, userId },
        });
  }

  /**
   * Creates a new assignment attempt for the given assignment and user session.
   * @param assignmentId The ID of the assignment.
   * @param userSession The user session.
   * @returns A base assignment attempt response DTO.
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    const assignment = await this.assignmentService.findOne(
      assignmentId,
      userSession,
    );

    await this.validateNewAttempt(assignment, userSession);
    const attemptExpiresAt = this.calculateAttemptExpiresAt(assignment);

    // Create the assignment attempt
    const assignmentAttempt = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId,
        grade: undefined,
        userId: userSession.userId,
      },
    });

    // Fetch all questions and their variants
    const questions = await this.prisma.question.findMany({
      where: { assignmentId },
      include: { variants: true },
    });
    const randomizedQuestions = questions.map((question) => {
      if (
        question.type === QuestionType.SINGLE_CORRECT ||
        question.type === QuestionType.MULTIPLE_CORRECT
      ) {
        if (question.variants && question.variants.length > 0) {
          for (const variant of question.variants) {
            if (variant.choices) {
              variant.choices = AttemptHelper.shuffleJsonArray<Choice>(
                typeof variant.choices === "string"
                  ? (JSON.parse(variant.choices) as Choice[])
                  : (variant.choices as unknown as Choice[]),
              ) as unknown as JsonValue;
            }
          }
        } else if (question.choices) {
          question.choices = AttemptHelper.shuffleJsonArray<Choice>(
            typeof question.choices === "string"
              ? (JSON.parse(question.choices) as Choice[])
              : (question.choices as unknown as Choice[]),
          ) as unknown as JsonValue;
        }
      }
      return question;
    });

    const attemptQuestionVariants = randomizedQuestions.map((question) => {
      const selectedVariant =
        question.variants && question.variants.length > 0
          ? question.variants[
              Math.floor(Math.random() * question.variants.length)
            ]
          : undefined;

      return {
        assignmentAttemptId: assignmentAttempt.id,
        questionId: question.id,
        questionVariantId: selectedVariant ? selectedVariant.id : undefined,
      };
    });

    const validAttemptQuestionVariants = attemptQuestionVariants.filter(
      (aqv) => aqv.questionVariantId !== undefined,
    );

    if (validAttemptQuestionVariants.length > 0) {
      await this.prisma.assignmentAttemptQuestionVariant.createMany({
        data: validAttemptQuestionVariants,
      });
    }

    return {
      id: assignmentAttempt.id,
      success: true,
    };
  }

  /**
   * Updates an assignment attempt with the provided responses and calculates the grade.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param assignmentId The ID of the assignment.
   * @param updateAssignmentAttemptDto The update request DTO.
   * @param authCookie The authentication cookie for LTI gateway.
   * @param gradingCallbackRequired Whether a grading callback is required.
   * @returns An update assignment attempt response DTO.
   */
  async updateAssignmentAttempt(
    assignmentAttemptId: number,
    assignmentId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const { role } = request.userSession;
    if (role === UserRole.LEARNER) {
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: assignmentAttemptId },
      });
      this.validateAssignmentAttemptExpiry(assignmentAttempt.expiresAt);
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });
    const successfulQuestionResponses = await this.submitQuestions(
      updateAssignmentAttemptDto.responsesForQuestions as unknown as QuestionResponse[],
      assignmentAttemptId,
      role,
      assignmentId,
      updateAssignmentAttemptDto.authorQuestions,
      updateAssignmentAttemptDto.authorAssignmentDetails,
    );
    const { grade, totalPointsEarned, totalPossiblePoints } =
      role === UserRole.LEARNER
        ? this.calculateGradeForLearner(
            successfulQuestionResponses,
            assignment as unknown as GetAssignmentAttemptResponseDto,
          )
        : this.calculateGradeForAuthor(
            successfulQuestionResponses,
            updateAssignmentAttemptDto.authorQuestions,
          );

    if (gradingCallbackRequired && role === UserRole.LEARNER) {
      await this.sendGradeToLtiGateway(grade, authCookie);
    }

    if (role === UserRole.AUTHOR) {
      // if the request is from the author, we don't need to reflect the grade in the database since it's just a test run
      return {
        id: -1,
        submitted: true,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        grade: assignment.showAssignmentScore ? grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        feedbacksForQuestions: this.constructFeedbacksForQuestions(
          successfulQuestionResponses,
          assignment as unknown as LearnerGetAssignmentResponseDto,
        ),
      };
    } else {
      const result = await this.updateAssignmentAttemptInDb(
        assignmentAttemptId,
        updateAssignmentAttemptDto,
        grade,
      );
      return {
        id: result.id,
        submitted: result.submitted,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        grade: assignment.showAssignmentScore ? result.grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        feedbacksForQuestions: this.constructFeedbacksForQuestions(
          successfulQuestionResponses,
          assignment as unknown as LearnerGetAssignmentResponseDto,
        ),
      };
    }
  }
  async getLearnerAssignmentAttempt(
    assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: {
            questionVariant: {
              include: {
                variantOf: true, // Original question data
              },
            },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }
    // Fetch all questions, including deleted ones
    const questions = await this.prisma.question.findMany({
      where: { assignmentId: assignmentAttempt.assignmentId },
    });
    if (!questions) {
      throw new NotFoundException(
        `Questions for assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
      },
    });

    this.sortAssignmentQuestions(assignment as LearnerGetAssignmentResponseDto);
    // Filter questions by attemptQuestionIds
    const filteredQuestions = questions.filter((q) =>
      assignmentAttempt.questionResponses.some((qr) => qr.questionId === q.id),
    );

    const questionsWithVariants = filteredQuestions.map((question) => {
      const variantMapping = assignmentAttempt.questionVariants.find(
        (qv) => qv.questionId === question.id,
      );
      const variant = variantMapping?.questionVariant;
      return {
        id: question.id,
        question: variant?.variantContent ?? question.question,
        choices: variant?.choices ?? question.choices,
        maxWords: variant?.maxWords ?? question.maxWords,
        maxCharacters: variant?.maxCharacters ?? question.maxCharacters,
        scoring: variant?.scoring ?? question.scoring,
        totalPoints: question.totalPoints,
        answer: variant?.answer ?? question.answer,
        type: question.type,
        assignmentId: question.assignmentId,
        gradingContextQuestionIds: question?.gradingContextQuestionIds,
        responseType: question.responseType,
        isDeleted: question.isDeleted,
      };
    });
    const questionsWithResponses = this.constructQuestionsWithResponses(
      questionsWithVariants,
      assignmentAttempt.questionResponses as unknown as QuestionResponse[],
    );
    // Ensure all chosen questions appear, even if no responses or variants
    const allQuestions = questionsWithVariants.map((question) => {
      const existing = questionsWithResponses.find((q) => q.id === question.id);
      return existing || { ...question, questionResponses: [] };
    });
    delete assignmentAttempt.questionResponses;
    // sort questions by display order
    allQuestions.sort((a, b) => a.id - b.id);

    if (assignment.showAssignmentScore === false) {
      delete assignmentAttempt.grade;
    }
    if (assignment.showSubmissionFeedback === false) {
      for (const q of questionsWithResponses) {
        if (q.questionResponses[0]?.feedback) {
          delete q.questionResponses[0].feedback;
        }
      }
    }
    if (assignment.showQuestionScore === false) {
      for (const q of questionsWithResponses) {
        if (q.questionResponses[0]?.points !== undefined) {
          q.questionResponses[0].points = -1;
        }
      }
    }
    // get assignment showAssignmentScore, showSubmissionFeedback, showQuestionScore from assignment and return
    return {
      ...assignmentAttempt,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      questions: allQuestions.map((question) => ({
        ...question,
        choices:
          typeof question.choices === "string"
            ? (JSON.parse(question.choices) as Choice[])
            : (question.choices as Choice[]),
      })),
      passingGrade: assignment.passingGrade,
    };
  }

  /**
   * Retrieves an assignment attempt along with its questions and responses.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @returns A get assignment attempt response DTO.
   */
  async getAssignmentAttempt(
    assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: {
            questionVariant: true,
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: {
          where: {
            isDeleted: false,
          },
        },
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
      },
    })) as LearnerGetAssignmentResponseDto;

    this.sortAssignmentQuestions(assignment);

    const questionsWithVariants = assignment.questions.map((question) => {
      const variantMapping = assignmentAttempt.questionVariants.find(
        (qv) => qv.questionId === question.id,
      );
      const variant = variantMapping?.questionVariant;
      return {
        id: question.id,
        question: variant?.variantContent ?? question.question,
        choices: variant?.choices ?? question.choices,
        maxWords: variant?.maxWords ?? question.maxWords,
        maxCharacters: variant?.maxCharacters ?? question.maxCharacters,
        scoring: variant?.scoring ?? question.scoring,
        totalPoints: question.totalPoints,
        answer: variant?.answer ?? question.answer,
        type: question.type,
        assignmentId: question.assignmentId,
        gradingContextQuestionIds: question?.gradingContextQuestionIds,
        responseType: question.responseType,
        isDeleted: question.isDeleted,
      };
    });
    const questionsWithResponses = this.constructQuestionsWithResponses(
      questionsWithVariants,
      assignmentAttempt.questionResponses as unknown as QuestionResponse[],
    );
    delete assignmentAttempt.questionResponses;

    if (assignment.showAssignmentScore === false) {
      delete assignmentAttempt.grade;
    }
    if (assignment.showSubmissionFeedback === false) {
      for (const q of questionsWithResponses) {
        if (q.questionResponses[0]?.feedback) {
          delete q.questionResponses[0].feedback;
        }
      }
    }
    if (assignment.showQuestionScore === false) {
      for (const q of questionsWithResponses) {
        if (q.questionResponses[0]?.points !== undefined) {
          q.questionResponses[0].points = -1;
        }
      }
    }
    // // randomize the order of question choices for single and multiple correct questions
    // const randomizedQuestions = questionsWithResponses.map((question) => {
    //   if (
    //     (question.type === QuestionType.SINGLE_CORRECT ||
    //       question.type === QuestionType.MULTIPLE_CORRECT) &&
    //     question.choices.length > 0
    //   ) {
    //     question.choices = AttemptHelper.shuffleJsonArray<Choice>(
    //       question.choices
    //     );
    //   }
    //   return question;
    // });
    return {
      ...assignmentAttempt,
      questions: questionsWithResponses,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
    };
  }

  /**
   * Creates a question response for a specific question in an assignment attempt.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param questionId The ID of the question.
   * @param createQuestionResponseAttemptRequestDto The create request DTO.
   * @returns A create question response attempt response DTO.
   */
  async createQuestionResponse(
    assignmentAttemptId: number,
    questionId: number,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    role: UserRole,
    assignmentId: number,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let question: QuestionDto;
    let assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };

    if (role === UserRole.LEARNER) {
      // Fetch the assignment attempt, including the selected variants
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: assignmentAttemptId },
        include: {
          questionVariants: {
            select: {
              questionId: true,
              questionVariant: {
                include: {
                  variantOf: true,
                },
              },
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
      if (variantMapping && variantMapping.questionVariant) {
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
            typeof variant.scoring === "string"
              ? (JSON.parse(variant.scoring) as Scoring)
              : ((variant.scoring as unknown as Scoring) ??
                (typeof baseQuestion.scoring === "string"
                  ? (JSON.parse(baseQuestion.scoring) as Scoring)
                  : (baseQuestion.scoring as unknown as Scoring))),
          choices:
            typeof variant.choices === "string"
              ? (JSON.parse(variant.choices) as Choice[])
              : ((variant.choices as unknown as Choice[]) ??
                (typeof baseQuestion.choices === "string"
                  ? (JSON.parse(baseQuestion.choices) as Choice[])
                  : (baseQuestion.choices as unknown as Choice[]))),

          answer: variant.answer ?? baseQuestion.answer,
          alreadyInBackend: true,
          totalPoints: baseQuestion.totalPoints,
        };
      } else {
        question = await this.questionService.findOne(questionId);
      }

      assignmentContext = await this.getAssignmentContext(
        assignmentAttempt.assignmentId,
        questionId,
        assignmentAttemptId,
        role,
      );
    } else if (role === UserRole.AUTHOR) {
      question = authorQuestions.find((q) => q.id === questionId);
      assignmentContext = {
        assignmentInstructions: assignmentDetails?.instructions ?? "",
        questionAnswerContext: [],
      };
    }
    const { responseDto, learnerResponse } = await this.processQuestionResponse(
      question,
      createQuestionResponseAttemptRequestDto,
      assignmentContext,
      assignmentId,
    );
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentAttemptId:
          role === UserRole.LEARNER ? assignmentAttemptId : 1,
        questionId: questionId,
        learnerResponse: JSON.stringify(learnerResponse),
        points: responseDto.totalPoints,
        feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      },
    });
    responseDto.id = result.id;
    responseDto.questionId = questionId;
    responseDto.question = question.question;
    return responseDto;
  }

  // Private helper methods

  /**
   * Validates whether a new attempt can be created for the given assignment and user session.
   * @param assignment The assignment object.
   * @param userSession The user session.
   */
  private async validateNewAttempt(
    assignment: LearnerGetAssignmentResponseDto,
    userSession: UserSession,
  ): Promise<void> {
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        OR: [
          {
            submitted: false,
            expiresAt: {
              gte: new Date(),
            },
          },
          {
            submitted: false,
            expiresAt: undefined,
          },
          {
            createdAt: {
              gte: timeRangeStartDate,
              lte: new Date(),
            },
          },
        ],
      },
    });

    const ongoingAttempts = attempts.filter(
      (sub) =>
        !sub.submitted &&
        (sub.expiresAt >= new Date() || sub.expiresAt === null),
    );

    const attemptsInTimeRange = attempts.filter(
      (sub) =>
        sub.createdAt >= timeRangeStartDate && sub.createdAt <= new Date(),
    );

    if (ongoingAttempts.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      );
    }
    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const attemptCount = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (attemptCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
      }
    }
  }

  /**
   * Calculates the expiration date for an attempt based on the assignment settings.
   * @param assignment The assignment object.
   * @returns The expiration date or null.
   */
  private calculateAttemptExpiresAt(
    assignment: LearnerGetAssignmentResponseDto,
  ): Date | null {
    if (
      assignment.allotedTimeMinutes !== undefined &&
      assignment.allotedTimeMinutes > 0
    ) {
      return new Date(Date.now() + assignment.allotedTimeMinutes * 60 * 1000);
    }
    return undefined;
  }

  /**
   * Validates whether the assignment attempt has expired.
   * @param expiresAt The expiration date of the assignment attempt.
   */
  private validateAssignmentAttemptExpiry(
    expiresAt: Date | null | undefined,
  ): void {
    const tenSecondsBeforeNow = new Date(Date.now() - 10 * 1000);
    if (expiresAt && tenSecondsBeforeNow > expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
  }

  /**
   * Submits the questions for the assignment attempt.
   * @param responsesForQuestions The responses for questions.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @returns A list of successful question response attempt response DTOs.
   */
  private async submitQuestions(
    responsesForQuestions: QuestionResponse[],
    assignmentAttemptId: number,
    role: UserRole,
    assignmentId: number,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
  ): Promise<CreateQuestionResponseAttemptResponseDto[]> {
    const questionResponsesPromise = responsesForQuestions.map(
      async (questionResponse) => {
        const { id: questionId, ...cleanedQuestionResponse } = questionResponse;
        return await this.createQuestionResponse(
          assignmentAttemptId,
          questionId,
          cleanedQuestionResponse,
          role,
          assignmentId,
          authorQuestions,
          assignmentDetails,
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
      .filter((response) => response.status === "rejected")
      .map((response) => response.reason as string);

    if (failedResponses.length > 0) {
      throw new InternalServerErrorException(
        `Failed to submit questions: ${failedResponses
          .map((response) => response)
          .join(", ")}`,
      );
    }

    return successfulResponses;
  }

  /**
   * Calculates the grade based on the question responses and assignment settings if the role is author.
   * @param successfulQuestionResponses
   * @param authorQuestions
   * @returns
   */
  private calculateGradeForAuthor(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    authorQuestions: QuestionDto[],
  ): { grade: number; totalPointsEarned: number; totalPossiblePoints: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0, totalPossiblePoints: 0 };
    }
    const totalPointsEarned = successfulQuestionResponses.reduce(
      (accumulator, response) => accumulator + response.totalPoints,
      0,
    );

    const totalPossiblePoints = authorQuestions.reduce(
      (accumulator: number, question: QuestionDto) =>
        accumulator + question.totalPoints,
      0,
    );

    const grade = totalPointsEarned / totalPossiblePoints;
    return { grade, totalPointsEarned, totalPossiblePoints };
  }

  /**
   * Calculates the grade based on the question responses and assignment settings if the role is learner.
   * @param successfulQuestionResponses The successful question responses.
   * @param assignment The assignment object.
   * @returns The calculated grade.
   */
  private calculateGradeForLearner(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    assignment: GetAssignmentAttemptResponseDto,
  ): { grade: number; totalPointsEarned: number; totalPossiblePoints: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0, totalPossiblePoints: 0 };
    }
    const totalPointsEarned = successfulQuestionResponses.reduce(
      (accumulator, response) => accumulator + response.totalPoints,
      0,
    );

    const totalPossiblePoints = assignment.questions.reduce(
      (accumulator: number, question: { totalPoints: number }) =>
        accumulator + question.totalPoints,
      0,
    );

    const grade = totalPointsEarned / totalPossiblePoints;
    return { grade, totalPointsEarned, totalPossiblePoints };
  }

  /**
   * Sends the grade to the LTI gateway if required.
   * @param grade The calculated grade.
   * @param authCookie The authentication cookie.
   */
  private async sendGradeToLtiGateway(
    grade: number,
    authCookie: string,
  ): Promise<void> {
    const ltiGatewayResponse = await this.httpService
      .put(
        process.env.GRADING_LTI_GATEWAY_URL,
        { score: grade },
        {
          headers: {
            Cookie: `authentication=${authCookie}`,
          },
        },
      )
      .toPromise();

    if (ltiGatewayResponse.status !== 200) {
      throw new InternalServerErrorException(GRADE_SUBMISSION_EXCEPTION);
    }
  }

  /**
   * Updates the assignment attempt in the database with the new grade.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param updateAssignmentAttemptDto The update request DTO.
   * @param grade The calculated grade.
   * @returns The updated assignment attempt.
   */
  private async updateAssignmentAttemptInDb(
    assignmentAttemptId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    grade: number,
  ) {
    // Omit fields that shouldn't be part of the update
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      responsesForQuestions,
      authorQuestions, // removing author questions from the update request
      authorAssignmentDetails, // removing author assignment details from the update request
      ...cleanedUpdateAssignmentAttemptDto
    } = updateAssignmentAttemptDto;

    return this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateAssignmentAttemptDto,
        expiresAt: new Date(),
        grade,
      },
      where: { id: assignmentAttemptId },
    });
  }

  /**
   * Constructs feedbacks for questions based on the assignment settings.
   * @param successfulQuestionResponses The successful question responses.
   * @param assignment The assignment object.
   * @returns An array of feedbacks for questions.
   */
  private constructFeedbacksForQuestions(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    assignment: LearnerGetAssignmentResponseDto,
  ) {
    return successfulQuestionResponses.map((feedbackForQuestion) => {
      const { totalPoints, feedback, ...otherData } = feedbackForQuestion;
      return {
        totalPoints: assignment.showQuestionScore ? totalPoints : -1,
        feedback: assignment.showSubmissionFeedback ? feedback : undefined,
        ...otherData,
      };
    });
  }

  /**
   * Checks whether the submission deadline has passed.
   * @param expiresAt The expiration date of the assignment attempt.
   */
  private checkSubmissionDeadline(expiresAt: Date | null | undefined): void {
    const thirtySecondsBeforeNow = new Date(Date.now() - 30 * 1000);
    if (expiresAt && thirtySecondsBeforeNow > expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
  }

  /**
   * Processes the question response based on the question type.
   * @param question The question object.
   * @param createQuestionResponseAttemptRequestDto The create request DTO.
   * @param assignmentContext The assignment context.
   * @returns An object containing the response DTO and learner response.
   */
  private async processQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string | { filename: string; content: string }[];
  }> {
    if (
      Array.isArray(
        createQuestionResponseAttemptRequestDto.learnerFileResponse,
      ) &&
      createQuestionResponseAttemptRequestDto.learnerFileResponse.length ===
        0 &&
      createQuestionResponseAttemptRequestDto.learnerUrlResponse.trim() ===
        "" &&
      createQuestionResponseAttemptRequestDto.learnerTextResponse.trim() ===
        "" &&
      Array.isArray(createQuestionResponseAttemptRequestDto.learnerChoices) &&
      createQuestionResponseAttemptRequestDto.learnerChoices.length === 0 &&
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null
    ) {
      const responseDto = new CreateQuestionResponseAttemptResponseDto();
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          feedback: "You did not provide a response to this question.",
        },
      ];
      return { responseDto, learnerResponse: "" };
    }

    switch (question.type) {
      case QuestionType.TEXT: {
        return this.handleTextUploadQuestionResponse(
          question,
          question.type,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
          assignmentId,
        );
      }
      case QuestionType.LINK_FILE: {
        if (createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
          return this.handleUrlQuestionResponse(
            question,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            assignmentId,
          );
        } else if (
          createQuestionResponseAttemptRequestDto.learnerFileResponse
        ) {
          return this.handleFileUploadQuestionResponse(
            question,
            question.type,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
          );
        } else {
          throw new BadRequestException(
            "Expected a file-based response (learnerFileResponse) or URL-based response (learnerUrlResponse), but did not receive one.",
          );
        }
      }
      case QuestionType.UPLOAD: {
        return this.handleFileUploadQuestionResponse(
          question,
          question.type,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
        );
      }
      case QuestionType.URL: {
        return this.handleUrlQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
          assignmentId,
        );
      }
      case QuestionType.TRUE_FALSE: {
        return this.handleTrueFalseQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      case QuestionType.SINGLE_CORRECT: {
        return this.handleSingleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return this.handleMultipleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      default: {
        throw new Error("Invalid question type provided.");
      }
    }
  }

  private async handleFileUploadQuestionResponse(
    question: QuestionDto,
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerFileUpload[];
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerFileResponse) {
      throw new BadRequestException(
        "Expected a file-based response (learnerFileResponse), but did not receive one.",
      );
    }
    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerFileResponse;
    const fileUploadQuestionEvaluateModel = new FileUploadQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext?.assignmentInstructions,
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring?.criteria ?? {},
      questionType,
      question.responseType ?? "OTHER",
    );
    const model = await this.llmService.gradeFileBasedQuestion(
      fileUploadQuestionEvaluateModel,
      question.assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles text and upload question responses.
   */
  private async handleTextUploadQuestionResponse(
    question: QuestionDto,
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  }> {
    const learnerResponse = await AttemptHelper.validateAndGetTextResponse(
      questionType,
      createQuestionResponseAttemptRequestDto,
    );

    const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext?.assignmentInstructions,
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring?.criteria ?? {},
      question.responseType ?? "OTHER",
    );

    const model = await this.llmService.gradeTextBasedQuestion(
      textBasedQuestionEvaluateModel,
      assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles URL question responses.
   */
  private async handleUrlQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
      throw new BadRequestException(
        "Expected a URL-based response (learnerUrlResponse), but did not receive one.",
      );
    }

    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerUrlResponse;

    const urlFetchResponse =
      await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
    if (!urlFetchResponse.isFunctional) {
      throw new BadRequestException(
        `Unable to extract content from the provided URL: ${learnerResponse}`,
      );
    }

    const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext.assignmentInstructions,
      learnerResponse,
      urlFetchResponse.isFunctional,
      JSON.stringify(urlFetchResponse.body),
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring?.criteria ?? {},
      question.responseType ?? "OTHER",
    );

    const model = await this.llmService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
      assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles true/false question responses.
   */
  private handleTrueFalseQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    if (
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null ||
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === undefined
    ) {
      throw new BadRequestException(
        "Expected a true/false response (learnerAnswerChoice), but did not receive one.",
      );
    }
    const correctAnswer =
      question.choices?.[0]?.choice.toLowerCase() === "true";
    const correctPoints = question.choices?.[0]?.points || 0;
    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice;
    const isCorrect = learnerChoice === correctAnswer;
    const feedback = isCorrect
      ? "Correct! Your answer is right."
      : `Incorrect. The correct answer is ${correctAnswer ? "True" : "False"}.`;

    const pointsAwarded = isCorrect ? correctPoints : 0;

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = pointsAwarded;
    responseDto.feedback = [{ feedback, choice: learnerChoice }];

    const learnerResponse = JSON.stringify(learnerChoice);
    return { responseDto, learnerResponse };
  }

  /**
   * Formats the feedback string by replacing placeholders with actual values.
   */
  private formatFeedback(
    feedbackTemplate: string,
    data: { [key: string]: unknown },
  ): string {
    return feedbackTemplate.replaceAll(
      /\${(.*?)}/g,
      (_, g: string) => (data[g] as string) || "",
    );
  }
  /**
   * Handles single correct question responses with custom feedbacks in Markdown format.
   */
  private handleSingleCorrectQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    // Ensure choices is an array
    const choices = this.parseChoices(question.choices);

    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerChoices[0];

    const correctChoice = choices.find((choice) => choice.isCorrect);

    const selectedChoice = choices.find(
      (choice) => choice.choice === learnerChoice,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    const data = {
      learnerChoice,
      correctChoice: correctChoice?.choice,
      points: selectedChoice?.points || 0,
    };

    if (selectedChoice) {
      let choiceFeedback = "";
      if (selectedChoice.feedback) {
        // Use custom feedback from the selected choice
        choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
      } else {
        // Use default feedback if custom feedback is not provided
        choiceFeedback = selectedChoice.isCorrect
          ? `**Correct selection:** ${learnerChoice} (+${selectedChoice.points} points)`
          : `**Incorrect selection:** ${learnerChoice} (${selectedChoice.points} points)`;
      }

      responseDto.totalPoints = selectedChoice.isCorrect
        ? selectedChoice.points
        : 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: choiceFeedback,
        },
      ] as ChoiceBasedFeedbackDto[];
    } else {
      // The learner selected an invalid choice
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: `**Invalid selection:** ${learnerChoice}`,
        },
      ] as ChoiceBasedFeedbackDto[];
    }

    const learnerResponse = JSON.stringify([learnerChoice]);
    return { responseDto, learnerResponse };
  }

  /**
   * Handles multiple correct question responses with custom feedbacks in Markdown format.
   */
  private handleMultipleCorrectQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (
      !createQuestionResponseAttemptRequestDto.learnerChoices ||
      createQuestionResponseAttemptRequestDto.learnerChoices.length === 0
    ) {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: [],
          feedback: "**You didn't select any option.**",
        },
      ] as unknown as ChoiceBasedFeedbackDto[];
      const learnerResponse = JSON.stringify([]);
      return { responseDto, learnerResponse };
    }

    const learnerChoices =
      createQuestionResponseAttemptRequestDto.learnerChoices;
    const choices = this.parseChoices(question.choices);
    const correctChoices = choices.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) => choice.choice);
    let totalPoints = 0;
    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + choice.points,
      0,
    );
    const feedbackDetails: string[] = [];

    for (const learnerChoice of learnerChoices) {
      const selectedChoice = choices.find(
        (choice) => choice.choice === learnerChoice,
      );

      const data = {
        learnerChoice,
        points: selectedChoice?.points || 0,
      };

      if (selectedChoice) {
        totalPoints += selectedChoice.points;

        let choiceFeedback = "";
        if (selectedChoice.feedback) {
          choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
        } else {
          choiceFeedback = selectedChoice.isCorrect
            ? `**Correct selection:** ${learnerChoice} (+${selectedChoice.points} points)`
            : `**Incorrect selection:** ${learnerChoice} (${selectedChoice.points} points)`;
        }
        feedbackDetails.push(choiceFeedback);
      } else {
        feedbackDetails.push(
          `**Invalid selection:** ${learnerChoice} (0 points)`,
        );
      }
    }

    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));
    const allCorrectSelected = correctChoiceTexts.every((choice) =>
      learnerChoices.includes(choice),
    );

    const feedbackMessage = `
${feedbackDetails.join(".\n")}.
${
  totalPoints < maxPoints || !allCorrectSelected
    ? `\nThe correct option(s) were: **${correctChoiceTexts.join(", ")}**.`
    : "\n**You selected all correct options!**"
}
`;

    const feedback: ChoiceBasedFeedbackDto[] = [
      {
        choice: learnerChoices.join(", "),
        feedback: feedbackMessage.trim(),
      },
    ];
    responseDto.totalPoints = finalPoints;
    responseDto.feedback = feedback;

    const learnerResponse = JSON.stringify(learnerChoices);
    return { responseDto, learnerResponse };
  }

  /**
   * Calculates the time range start date based on the assignment settings.
   * @param assignment The assignment object.
   * @returns The time range start date.
   */
  private calculateTimeRangeStartDate(
    assignment: LearnerGetAssignmentResponseDto,
  ): Date {
    if (assignment.attemptsTimeRangeHours) {
      return new Date(
        Date.now() - assignment.attemptsTimeRangeHours * 60 * 60 * 1000,
      );
    }
    return new Date();
  }

  /**
   * Counts the number of attempts made by a user for a specific assignment.
   * @param userId The user ID.
   * @param assignmentId The assignment ID.
   * @returns The number of attempts.
   */
  private async countUserAttempts(
    userId: string,
    assignmentId: number,
  ): Promise<number> {
    return this.prisma.assignmentAttempt.count({
      where: {
        userId: userId,
        assignmentId: assignmentId,
      },
    });
  }

  /**
   * Sorts the assignment questions based on the display order.
   * @param assignment The assignment object.
   */
  private sortAssignmentQuestions(
    assignment: LearnerGetAssignmentResponseDto,
  ): void {
    if (assignment.questions) {
      if (assignment.displayOrder === "RANDOM") {
        assignment.questions.sort(() => Math.random() - 0.5);
      } else if (assignment.questionOrder?.length > 0) {
        assignment.questions.sort(
          (a, b) =>
            assignment.questionOrder.indexOf(a.id) -
            assignment.questionOrder.indexOf(b.id),
        );
      }
    }
  }

  /**
   * Constructs questions with their corresponding responses.
   * @param questions The list of questions.
   * @param questionResponses The list of question responses.
   * @returns A list of questions with responses.
   */
  private constructQuestionsWithResponses(
    questions: Question[],
    questionResponses: QuestionResponse[],
  ): AssignmentAttemptQuestions[] {
    return questions.map((question) => {
      const correspondingResponses = questionResponses
        .filter((response) => response.questionId === question.id)
        .map((response) => ({
          id: response.id,
          assignmentAttemptId: response.assignmentAttemptId,
          questionId: response.questionId,
          learnerResponse: response.learnerResponse,
          points: response.points,
          feedback: response.feedback,
        }));

      // If choices are stored as JSON, ensure they are parsed properly into an array of objects
      const choices: {
        choice: string;
        points: number;
        feedback: string;
        isCorrect: boolean;
      }[] = question.choices
        ? // eslint-disable-next-line unicorn/no-nested-ternary
          typeof question.choices === "string"
          ? (JSON.parse(question.choices) as {
              choice: string;
              points: number;
              feedback: string;
              isCorrect: boolean;
            }[])
          : (question.choices as {
              choice: string;
              points: number;
              feedback: string;
              isCorrect: boolean;
            }[])
        : [];

      // Ensure the choices are in the expected format
      const formattedChoices = choices.map(
        (choice: {
          choice: string;
          points: number;
          feedback: string;
          isCorrect: boolean;
        }) => ({
          choice: choice.choice,
          points: choice.points,
          feedback: choice.feedback,
          isCorrect: choice.isCorrect,
        }),
      );

      return {
        id: question.id,
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        maxCharacters: question.maxCharacters,
        type: question.type,
        question: question.question,
        choices: formattedChoices, // Use the formatted choices
        assignmentId: question.assignmentId,
        alreadyInBackend: true,
        questionResponses: correspondingResponses,
        responseType: question.responseType,
      };
    });
  }
  private parseChoices(choices: unknown): Choice[] {
    if (!choices) {
      return [];
    }
    if (typeof choices === "string") {
      return JSON.parse(choices) as Choice[];
    }
    return choices as Choice[];
  }

  /**
   * Retrieves the assignment context required for grading.
   * @param assignmentId The assignment ID.
   * @param questionId The question ID.
   * @param assignmentAttemptId The assignment attempt ID.
   * @returns An object containing assignment instructions and question answer context.
   */
  private async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
    role: UserRole,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: Assignment,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    let assignmentInstructions = "";
    let questionsAnswersContext: QuestionAnswerContext[] = [];

    if (role === UserRole.AUTHOR && assignmentDetails && authorQuestions) {
      // Use the provided assignment details and questions for the author mode
      assignmentInstructions = assignmentDetails.instructions || "";
      const authorQuestion = authorQuestions.find((q) => q.id === questionId);

      if (!authorQuestion) {
        throw new Error("Question not found in author questions.");
      }

      questionsAnswersContext = authorQuestions.map((q) => ({
        question: q.question,
        answer: "", // No learner answers available in author mode
      }));
    } else {
      // Default behavior for learner mode
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { instructions: true },
      });

      assignmentInstructions = assignment.instructions || "";

      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { gradingContextQuestionIds: true },
      });

      if (!question) {
        throw new Error("Question not found.");
      }

      const contextQuestions = await this.prisma.question.findMany({
        where: {
          id: {
            in: question.gradingContextQuestionIds,
          },
        },
        select: { id: true, question: true, type: true },
      });

      const allResponses = await this.prisma.questionResponse.findMany({
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

      const groupedResponses: {
        [key: number]: GetQuestionResponseAttemptResponseDto;
      } = {};

      for (const response of allResponses) {
        if (!groupedResponses[response.questionId]) {
          groupedResponses[response.questionId] = response;
        }
      }

      questionsAnswersContext = await Promise.all(
        contextQuestions.map(async (contextQuestion) => {
          let learnerResponse =
            groupedResponses[contextQuestion.id]?.learnerResponse || "";

          if (contextQuestion.type === "URL" && learnerResponse) {
            const urlContent =
              await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
            learnerResponse = JSON.stringify({
              url: learnerResponse,
              ...urlContent,
            });
          }

          return {
            question: contextQuestion.question,
            answer: learnerResponse,
          };
        }),
      );
    }

    return {
      assignmentInstructions,
      questionAnswerContext: questionsAnswersContext,
    };
  }

  async createReport(
    assignmentId: number,
    attemptId: number,
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
    // check if assignment attempt exists
    const assignmentAttemptExists =
      await this.prisma.assignmentAttempt.findUnique({
        where: { id: attemptId },
      });
    if (!assignmentAttemptExists) {
      throw new NotFoundException("Assignment attempt not found");
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
        attemptId,
        issueType,
        description,
        reporterId: userId,
        author: false,
      },
    });
  }
}
