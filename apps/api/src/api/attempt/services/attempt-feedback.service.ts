import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class AttemptFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit feedback for an assignment attempt
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param feedbackDto Feedback data
   * @param userSession User session information
   * @returns Promise with feedback response
   */
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
          allowContact: feedbackDto.allowContact,
          firstName: feedbackDto.firstName,
          lastName: feedbackDto.lastName,
          email: feedbackDto.email,
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
          allowContact: feedbackDto.allowContact,
          firstName: feedbackDto.firstName,
          lastName: feedbackDto.lastName,
          email: feedbackDto.email,
        },
      });

      return {
        success: true,
        id: feedback.id,
      };
    }
  }

  /**
   * Get feedback for an assignment attempt
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param userSession User session information
   * @returns Promise with feedback data
   */
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
}
