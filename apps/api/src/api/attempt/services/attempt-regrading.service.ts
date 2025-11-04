import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RegradingStatus } from "@prisma/client";
import {
  RegradingRequestDto,
  RegradingStatusResponseDto,
  RequestRegradingResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import { EmailService } from "../../../common/services/email.service";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class AttemptRegradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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
      await this.prisma.regradingRequest.findFirst({
        where: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
        },
      });

    let regradingRequestId: number;

    if (existingRegradingRequest) {
      const updatedRegradingRequest = await this.prisma.regradingRequest.update(
        {
          where: { id: existingRegradingRequest.id },
          data: {
            regradingReason: regradingRequestDto.reason,
            proposedGrade: regradingRequestDto.proposedGrade,
            questionIds: regradingRequestDto.questionIds || [],
            regradingStatus: RegradingStatus.PENDING,
            updatedAt: new Date(),
          },
        },
      );
      regradingRequestId = updatedRegradingRequest.id;
    } else {
      const regradingRequest = await this.prisma.regradingRequest.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          regradingReason: regradingRequestDto.reason,
          proposedGrade: regradingRequestDto.proposedGrade,
          questionIds: regradingRequestDto.questionIds || [],
          regradingStatus: RegradingStatus.PENDING,
        },
      });
      regradingRequestId = regradingRequest.id;
    }

    await this.sendRegradingNotification(
      assignmentId,
      attemptId,
      regradingRequestId,
      regradingRequestDto,
      userSession.userId,
      assignmentAttempt.grade || 0,
    );

    return {
      success: true,
      id: regradingRequestId,
    };
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

  /**
   * Send email notification to authors about regrading request
   * @private
   */
  private async sendRegradingNotification(
    assignmentId: number,
    attemptId: number,
    regradingRequestId: number,
    regradingRequestDto: RegradingRequestDto,
    learnerUserId: string,
    currentGrade: number,
  ): Promise<void> {
    try {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { name: true },
      });

      if (!assignment) {
        return;
      }

      const assignmentAuthors = await this.prisma.assignmentAuthor.findMany({
        where: { assignmentId: assignmentId },
        select: { userId: true },
      });

      const authorEmails = assignmentAuthors.map((author) => author.userId);

      if (authorEmails.length === 0) {
        return;
      }

      const allAuthorSettings = await this.prisma.authorSettings.findMany({
        where: {
          userId: { in: authorEmails },
        },
        select: { userId: true, emailOnRegradingRequest: true },
      });

      const settingsMap = new Map(
        allAuthorSettings.map((s) => [s.userId, s.emailOnRegradingRequest]),
      );

      const finalEmailList = authorEmails.filter((email) => {
        const hasSetting = settingsMap.has(email);
        if (!hasSetting) {
          return true;
        }
        const shouldNotify = settingsMap.get(email);
        return shouldNotify;
      });

      if (finalEmailList.length === 0) {
        return;
      }

      await this.emailService.sendRegradingRequestNotification(
        finalEmailList,
        learnerUserId,
        assignment.name,
        assignmentId,
        attemptId,
        regradingRequestId,
        regradingRequestDto.reason,
        currentGrade,
        regradingRequestDto.proposedGrade ?? null,
        regradingRequestDto.questionIds ?? [],
      );
    } catch {
      // Error already logged in console.error above, don't fail the regrading request
    }
  }
}
