import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AssignmentQuestionDisplayOrder,
  QuestionDisplay,
} from "@prisma/client";
import { JsonValue } from "aws-sdk/clients/glue";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { PrismaService } from "../../../../prisma.service";

export interface SaveDraftDto {
  draftName?: string;
  assignmentData: Partial<{
    name: string;
    introduction: string;
    instructions: string;
    gradingCriteriaOverview: string;
    timeEstimateMinutes: number;
    type: string;
    graded: boolean;
    numAttempts: number;
    allotedTimeMinutes: number;
    attemptsPerTimeRange: number;
    attemptsTimeRangeHours: number;
    passingGrade: number;
    displayOrder: AssignmentQuestionDisplayOrder;
    questionDisplay: QuestionDisplay;
    numberOfQuestionsPerAttempt: number;
    questionOrder: number[];
    showAssignmentScore: boolean;
    showQuestionScore: boolean;
    showSubmissionFeedback: boolean;
    showQuestions: boolean;
    languageCode: string;
  }>;
  questionsData?: Array<any>;
}

export interface DraftSummary {
  id: number;
  draftName: string;
  assignmentName: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  questionCount: number;
}

@Injectable()
export class DraftManagementService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "DraftManagementService" });
  }

  private parseDisplayOrder(
    value: any,
  ): AssignmentQuestionDisplayOrder | undefined {
    if (value === "DEFINED" || value === "RANDOM") {
      return value as AssignmentQuestionDisplayOrder;
    }
    return undefined;
  }

  private parseQuestionDisplay(value: any): QuestionDisplay | undefined {
    if (value === "ONE_PER_PAGE" || value === "ALL_PER_PAGE") {
      return value as QuestionDisplay;
    }
    return undefined;
  }

  async saveDraft(
    assignmentId: number,
    saveDraftDto: SaveDraftDto,
    userSession: UserSession,
  ): Promise<DraftSummary> {
    this.logger.info(`Saving draft for assignment ${assignmentId}`, {
      userId: userSession.userId,
      draftName: saveDraftDto.draftName,
    });

    // Verify assignment exists and user has access
    // await this.verifyAssignmentAccess(assignmentId, userSession);

    // Get the base assignment for reference
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { questions: { where: { isDeleted: false } } },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    const draftName =
      saveDraftDto.draftName || `Draft - ${new Date().toLocaleString()}`;

    return await this.prisma.$transaction(async (tx) => {
      // Create assignment draft
      const assignmentDraft = await tx.assignmentDraft.create({
        data: {
          assignmentId,
          userId: userSession.userId,
          draftName,
          name: saveDraftDto.assignmentData?.name || assignment.name,
          introduction:
            saveDraftDto.assignmentData?.introduction ??
            assignment.introduction,
          instructions:
            saveDraftDto.assignmentData?.instructions ??
            assignment.instructions,
          gradingCriteriaOverview:
            saveDraftDto.assignmentData?.gradingCriteriaOverview ??
            assignment.gradingCriteriaOverview,
          timeEstimateMinutes:
            saveDraftDto.assignmentData?.timeEstimateMinutes ||
            assignment.timeEstimateMinutes,
          type: assignment.type,
          graded: saveDraftDto.assignmentData?.graded ?? assignment.graded,
          numAttempts:
            saveDraftDto.assignmentData?.numAttempts ?? assignment.numAttempts,
          allotedTimeMinutes:
            saveDraftDto.assignmentData?.allotedTimeMinutes ??
            assignment.allotedTimeMinutes,
          attemptsPerTimeRange:
            saveDraftDto.assignmentData?.attemptsPerTimeRange ??
            assignment.attemptsPerTimeRange,
          attemptsTimeRangeHours:
            saveDraftDto.assignmentData?.attemptsTimeRangeHours ??
            assignment.attemptsTimeRangeHours,
          passingGrade:
            saveDraftDto.assignmentData?.passingGrade ??
            assignment.passingGrade,
          displayOrder:
            this.parseDisplayOrder(saveDraftDto.assignmentData?.displayOrder) ??
            assignment.displayOrder,
          questionDisplay:
            this.parseQuestionDisplay(
              saveDraftDto.assignmentData?.questionDisplay,
            ) ?? assignment.questionDisplay,
          numberOfQuestionsPerAttempt:
            saveDraftDto.assignmentData?.numberOfQuestionsPerAttempt ??
            assignment.numberOfQuestionsPerAttempt,
          questionOrder:
            saveDraftDto.assignmentData?.questionOrder ??
            assignment.questionOrder,
          published: false,
          showAssignmentScore:
            saveDraftDto.assignmentData?.showAssignmentScore ??
            assignment.showAssignmentScore,
          showQuestionScore:
            saveDraftDto.assignmentData?.showQuestionScore ??
            assignment.showQuestionScore,
          showSubmissionFeedback:
            saveDraftDto.assignmentData?.showSubmissionFeedback ??
            assignment.showSubmissionFeedback,
          showQuestions:
            saveDraftDto.assignmentData?.showQuestions ??
            assignment.showQuestions,
          languageCode:
            saveDraftDto.assignmentData?.languageCode ??
            assignment.languageCode,
          questionsData: saveDraftDto.questionsData
            ? JSON.stringify(saveDraftDto.questionsData)
            : null,
        },
      });

      this.logger.info(
        `Created draft "${draftName}" for assignment ${assignmentId}`,
        {
          draftId: assignmentDraft.id,
          userId: userSession.userId,
        },
      );

      return {
        id: assignmentDraft.id,
        draftName: assignmentDraft.draftName,
        assignmentName: assignmentDraft.name,
        userId: assignmentDraft.userId,
        createdAt: assignmentDraft.createdAt,
        updatedAt: assignmentDraft.updatedAt,
        questionCount: saveDraftDto.questionsData?.length || 0,
      };
    });
  }

  async updateDraft(
    draftId: number,
    saveDraftDto: SaveDraftDto,
    userSession: UserSession,
  ): Promise<DraftSummary> {
    this.logger.info(`Updating draft ${draftId}`, {
      userId: userSession.userId,
    });

    // Verify draft exists and user owns it
    const existingDraft = await this.prisma.assignmentDraft.findUnique({
      where: { id: draftId },
    });

    if (!existingDraft) {
      throw new NotFoundException("Draft not found");
    }

    if (existingDraft.userId !== userSession.userId) {
      throw new BadRequestException("You can only update your own drafts");
    }

    const updatedDraft = await this.prisma.assignmentDraft.update({
      where: { id: draftId },
      data: {
        ...(saveDraftDto.draftName && { draftName: saveDraftDto.draftName }),
        ...(saveDraftDto.assignmentData?.name && {
          name: saveDraftDto.assignmentData.name,
        }),
        ...(saveDraftDto.assignmentData?.introduction !== undefined && {
          introduction: saveDraftDto.assignmentData.introduction,
        }),
        ...(saveDraftDto.assignmentData?.instructions !== undefined && {
          instructions: saveDraftDto.assignmentData.instructions,
        }),
        ...(saveDraftDto.assignmentData?.gradingCriteriaOverview !==
          undefined && {
          gradingCriteriaOverview:
            saveDraftDto.assignmentData.gradingCriteriaOverview,
        }),
        ...(saveDraftDto.assignmentData?.timeEstimateMinutes && {
          timeEstimateMinutes: saveDraftDto.assignmentData.timeEstimateMinutes,
        }),
        ...(saveDraftDto.assignmentData?.graded !== undefined && {
          graded: saveDraftDto.assignmentData.graded,
        }),
        ...(saveDraftDto.assignmentData?.numAttempts !== undefined && {
          numAttempts: saveDraftDto.assignmentData.numAttempts,
        }),
        ...(saveDraftDto.assignmentData?.allotedTimeMinutes !== undefined && {
          allotedTimeMinutes: saveDraftDto.assignmentData.allotedTimeMinutes,
        }),
        ...(saveDraftDto.assignmentData?.attemptsPerTimeRange !== undefined && {
          attemptsPerTimeRange:
            saveDraftDto.assignmentData.attemptsPerTimeRange,
        }),
        ...(saveDraftDto.assignmentData?.attemptsTimeRangeHours !==
          undefined && {
          attemptsTimeRangeHours:
            saveDraftDto.assignmentData.attemptsTimeRangeHours,
        }),
        ...(saveDraftDto.assignmentData?.passingGrade !== undefined && {
          passingGrade: saveDraftDto.assignmentData.passingGrade,
        }),
        ...(saveDraftDto.assignmentData?.displayOrder !== undefined && {
          displayOrder: this.parseDisplayOrder(
            saveDraftDto.assignmentData.displayOrder,
          ),
        }),
        ...(saveDraftDto.assignmentData?.questionDisplay !== undefined && {
          questionDisplay: this.parseQuestionDisplay(
            saveDraftDto.assignmentData.questionDisplay,
          ),
        }),
        ...(saveDraftDto.assignmentData?.numberOfQuestionsPerAttempt !==
          undefined && {
          numberOfQuestionsPerAttempt:
            saveDraftDto.assignmentData.numberOfQuestionsPerAttempt,
        }),
        ...(saveDraftDto.assignmentData?.questionOrder && {
          questionOrder: saveDraftDto.assignmentData.questionOrder,
        }),
        ...(saveDraftDto.assignmentData?.showAssignmentScore !== undefined && {
          showAssignmentScore: saveDraftDto.assignmentData.showAssignmentScore,
        }),
        ...(saveDraftDto.assignmentData?.showQuestionScore !== undefined && {
          showQuestionScore: saveDraftDto.assignmentData.showQuestionScore,
        }),
        ...(saveDraftDto.assignmentData?.showSubmissionFeedback !==
          undefined && {
          showSubmissionFeedback:
            saveDraftDto.assignmentData.showSubmissionFeedback,
        }),
        ...(saveDraftDto.assignmentData?.showQuestions !== undefined && {
          showQuestions: saveDraftDto.assignmentData.showQuestions,
        }),
        ...(saveDraftDto.assignmentData?.languageCode && {
          languageCode: saveDraftDto.assignmentData.languageCode,
        }),
        ...(saveDraftDto.questionsData && {
          questionsData: JSON.stringify(saveDraftDto.questionsData),
        }),
      },
    });

    return {
      id: updatedDraft.id,
      draftName: updatedDraft.draftName,
      assignmentName: updatedDraft.name,
      userId: updatedDraft.userId,
      createdAt: updatedDraft.createdAt,
      updatedAt: updatedDraft.updatedAt,
      questionCount: saveDraftDto.questionsData?.length || 0,
    };
  }

  async listUserDrafts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<DraftSummary[]> {
    // Verify assignment access
    // await this.verifyAssignmentAccess(assignmentId, userSession);

    const drafts = await this.prisma.assignmentDraft.findMany({
      where: {
        assignmentId,
        userId: userSession.userId,
      },
      orderBy: { updatedAt: "desc" },
    });

    return drafts.map((draft) => ({
      id: draft.id,
      draftName: draft.draftName,
      assignmentName: draft.name,
      userId: draft.userId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      questionCount: JSON.parse(draft.questionsData as string).length ?? 0,
    }));
  }

  async getDraft(
    draftId: number,
    userSession: UserSession,
  ): Promise<{
    id: number;
    name: string;
    introduction: string;
    instructions: string;
    gradingCriteriaOverview: string;
    timeEstimateMinutes: number;
    type: string;
    graded: boolean;
    numAttempts: number;
    allotedTimeMinutes: number;
    attemptsPerTimeRange: number;
    attemptsTimeRangeHours: number;
    passingGrade: number;
    displayOrder: AssignmentQuestionDisplayOrder;
    questionDisplay: QuestionDisplay;
    numberOfQuestionsPerAttempt: number;
    questionOrder: number[];
    published: boolean;
    showAssignmentScore: boolean;
    showQuestionScore: boolean;
    showSubmissionFeedback: boolean;
    showQuestions: boolean;
    languageCode: string;
    questions: JsonValue[];
    _isDraft?: boolean;
    _draftId?: number;
    _draftName?: string;
    _draftUpdatedAt?: Date;
  }> {
    const draft = await this.prisma.assignmentDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      throw new NotFoundException("Draft not found");
    }

    if (draft.userId !== userSession.userId) {
      throw new BadRequestException("You can only access your own drafts");
    }

    return {
      id: draft.assignmentId,
      name: draft.name,
      introduction: draft.introduction,
      instructions: draft.instructions,
      gradingCriteriaOverview: draft.gradingCriteriaOverview,
      timeEstimateMinutes: draft.timeEstimateMinutes,
      type: draft.type,
      graded: draft.graded,
      numAttempts: draft.numAttempts,
      allotedTimeMinutes: draft.allotedTimeMinutes,
      attemptsPerTimeRange: draft.attemptsPerTimeRange,
      attemptsTimeRangeHours: draft.attemptsTimeRangeHours,
      passingGrade: draft.passingGrade,
      displayOrder: draft.displayOrder,
      questionDisplay: draft.questionDisplay,
      numberOfQuestionsPerAttempt: draft.numberOfQuestionsPerAttempt,
      questionOrder: draft.questionOrder,
      published: draft.published,
      showAssignmentScore: draft.showAssignmentScore,
      showQuestionScore: draft.showQuestionScore,
      showSubmissionFeedback: draft.showSubmissionFeedback,
      showQuestions: draft.showQuestions,
      languageCode: draft.languageCode,
      questions:
        (JSON.parse(draft.questionsData as string) as unknown as JsonValue[]) ??
        [],
      _isDraft: true,
      _draftId: draft.id,
      _draftName: draft.draftName,
      _draftUpdatedAt: draft.updatedAt,
    };
  }

  async deleteDraft(draftId: number, userSession: UserSession): Promise<void> {
    const draft = await this.prisma.assignmentDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      throw new NotFoundException("Draft not found");
    }

    if (draft.userId !== userSession.userId) {
      throw new BadRequestException("You can only delete your own drafts");
    }

    await this.prisma.assignmentDraft.delete({
      where: { id: draftId },
    });

    this.logger.info(`Deleted draft ${draftId}`, {
      userId: userSession.userId,
    });
  }

  async getLatestDraft(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<{
    id: number;
    name: string;
    introduction: string;
    instructions: string;
    gradingCriteriaOverview: string;
    timeEstimateMinutes: number;
    type: string;
    graded: boolean;
    numAttempts: number;
    allotedTimeMinutes: number;
    attemptsPerTimeRange: number;
    attemptsTimeRangeHours: number;
    passingGrade: number;
    displayOrder: AssignmentQuestionDisplayOrder;
    questionDisplay: QuestionDisplay;
    numberOfQuestionsPerAttempt: number;
    questionOrder: number[];
    published: boolean;
    showAssignmentScore: boolean;
    showQuestionScore: boolean;
    showSubmissionFeedback: boolean;
    showQuestions: boolean;
    languageCode: string;
    questions: JsonValue[];
    _isDraft?: boolean;
    _draftId?: number;
    _draftName?: string;
    _draftUpdatedAt?: Date;
  }> {
    // Verify assignment access
    // await this.verifyAssignmentAccess(assignmentId, userSession);

    const latestDraft = await this.prisma.assignmentDraft.findFirst({
      where: {
        assignmentId,
        userId: userSession.userId,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!latestDraft) {
      return null;
    }

    return this.getDraft(latestDraft.id, userSession);
  }

  private async verifyAssignmentAccess(
    assignmentId: number,
    userSession: UserSession,
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { AssignmentAuthor: true },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (userSession.role === UserRole.AUTHOR) {
      const hasAccess = assignment.AssignmentAuthor.some(
        (author) => author.userId === userSession.userId,
      );
      if (!hasAccess) {
        throw new NotFoundException("Assignment not found");
      }
    }
  }
}
