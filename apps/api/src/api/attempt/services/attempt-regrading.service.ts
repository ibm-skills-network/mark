import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { RegradingStatus } from "@prisma/client";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import {
  RegradingRequestDto,
  RequestRegradingResponseDto,
  RegradingStatusResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";

@Injectable()
export class AttemptRegradingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process a regrading request
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param regradingRequestDto Regrading request data
   * @param userSession User session information
   * @returns Promise with regrading request response
   */
  async processRegradingRequest(
    assignmentId: number,
    attemptId: number,
    regradingRequestDto: RegradingRequestDto,
    userSession: UserSession,
  ): Promise<RequestRegradingResponseDto> {
    // Validate the attempt exists
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    // Ensure assignment ID matches
    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    // Ensure user has permission for this attempt
    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to request regrading for this attempt.",
      );
    }

    // Check for existing regrading request
    const existingRegradingRequest =
      await this.prisma.regradingRequest.findFirst({
        where: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
        },
      });

    if (existingRegradingRequest) {
      // Update the existing request
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
      // Create a new regrading request
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

  /**
   * Get the status of a regrading request
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param userSession User session information
   * @returns Promise with regrading status response
   */
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
}
