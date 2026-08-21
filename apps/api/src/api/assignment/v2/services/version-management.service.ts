/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Assignment,
  AssignmentVersion,
  Prisma,
  Question,
} from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { applyQuestionOrder } from "../../utils/question-order.util";
import { clampQuestionsPerAttempt } from "../../utils/questions-per-attempt.util";
import { PrismaService } from "../../../../database/prisma.service";
import { AttemptAccessCacheService } from "../../../attempt/services/attempt-access-cache.service";
import { QuestionDto } from "../../dto/update.questions.request.dto";

export interface CreateVersionDto {
  versionNumber?: string;
  versionDescription?: string;
  isDraft?: boolean;
  shouldActivate?: boolean;
  updateExisting?: boolean;
  versionId?: number;
}

export interface CompareVersionsDto {
  fromVersionId: number;
  toVersionId: number;
}

export interface RestoreVersionDto {
  versionId: number;
  createAsNewVersion?: boolean;
  versionDescription?: string;
}

export interface SaveDraftDto {
  assignmentData: Partial<Assignment>;
  questionsData?: Array<QuestionDto>;
  versionDescription?: string;
  versionNumber?: string;
}

export interface VersionSummary {
  id: number;
  versionNumber: string;
  versionDescription?: string;
  isDraft: boolean;
  isActive: boolean;
  published: boolean;
  createdBy: string;
  createdAt: Date;
  questionCount: number;
  wasAutoIncremented?: boolean;
  originalVersionNumber?: string;
}

export interface VersionComparison {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  assignmentChanges: Array<{
    field: string;
    fromValue: any;
    toValue: any;
    changeType: "added" | "modified" | "removed";
  }>;
  questionChanges: Array<{
    questionId?: number;
    displayOrder: number;
    changeType: "added" | "modified" | "removed";
    field?: string;
    fromValue?: any;
    toValue?: any;
  }>;
}

@Injectable()
export class VersionManagementService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly attemptAccessCache: AttemptAccessCacheService,
  ) {
    this.logger = parentLogger.child({ context: "VersionManagementService" });
  }

  /**
   * Get the most recently created version for an assignment
   */
  async getLatestVersion(assignmentId: number): Promise<VersionSummary | null> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { AssignmentAuthor: true },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    const latestVersion = await this.prisma.assignmentVersion.findFirst({
      where: { assignmentId },
      include: { _count: { select: { questionVersions: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (!latestVersion) {
      return null;
    }

    return {
      id: latestVersion.id,
      versionNumber: latestVersion.versionNumber,
      versionDescription: latestVersion.versionDescription,
      isDraft: latestVersion.isDraft,
      isActive: latestVersion.isActive,
      published: latestVersion.published,
      createdBy: latestVersion.createdBy,
      createdAt: latestVersion.createdAt,
      questionCount: latestVersion._count.questionVersions,
    };
  }

  async createVersion(
    assignmentId: number,
    createVersionDto: CreateVersionDto,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(
      `🚀 CREATE VERSION: Starting for assignment ${assignmentId}`,
      {
        createVersionDto,
        userId: userSession.userId,
      },
    );

    this.logger.info(`🔍 VERSION CREATE PARAMS:`, {
      updateExisting: createVersionDto.updateExisting,
      versionId: createVersionDto.versionId,
      versionNumber: createVersionDto.versionNumber,
      isDraft: createVersionDto.isDraft,
    });

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: { where: { isDeleted: false } },
        versions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    this.logger.info(`Creating version for assignment ${assignmentId}`, {
      assignmentName: assignment.name,
      questionsFound: assignment.questions.length,
      questionIds: assignment.questions.map((q) => q.id),
      createVersionDto,
    });

    if (assignment.questions.length === 0) {
      this.logger.warn(
        `No legacy questions found for assignment ${assignmentId}. Creating version with empty questions.`,
      );
    }

    // A non-draft version is what learners get served, so snapshot a subset
    // size the snapshot can actually honour: attempt creation would otherwise
    // serve every question (see
    // AttemptSubmissionService.createAssignmentAttempt) while the stored
    // config still advertises the larger number. Clamping rather than
    // rejecting is what lets an author who deleted questions publish at all.
    // Drafts keep the author's number so mid-authoring edits are not rewritten
    // under them.
    const questionsPerAttempt = createVersionDto.isDraft
      ? assignment.numberOfQuestionsPerAttempt
      : clampQuestionsPerAttempt(
          assignment.numberOfQuestionsPerAttempt,
          assignment.questions.length,
        );
    const questionsPerAttemptWasClamped =
      questionsPerAttempt !== assignment.numberOfQuestionsPerAttempt;

    if (questionsPerAttemptWasClamped) {
      this.logger.warn(
        `Version creation: numberOfQuestionsPerAttempt clamped to the question pool`,
        {
          assignmentId,
          numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
          availableQuestions: assignment.questions.length,
          clampedPerAttempt: questionsPerAttempt,
          userId: userSession.userId,
        },
      );
    }

    let versionNumber: string;

    if (createVersionDto.versionNumber) {
      const semanticVersionRegex = /^\d+\.\d+\.\d+(?:-rc\d+)?$/;
      if (!semanticVersionRegex.test(createVersionDto.versionNumber)) {
        throw new BadRequestException(
          "Version number must follow semantic versioning format (e.g., '1.0.0' or '1.0.0-rc1')",
        );
      }
      versionNumber = createVersionDto.versionNumber;
    } else {
      const latestVersion = await this.prisma.assignmentVersion.findFirst({
        where: { assignmentId },
        orderBy: { createdAt: "desc" },
        select: { versionNumber: true },
      });

      if (latestVersion && /^\d+\.\d+\.\d+/.test(latestVersion.versionNumber)) {
        const match = latestVersion.versionNumber.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (match) {
          const [, major, minor, patch] = match;
          versionNumber = `${major}.${minor}.${Number.parseInt(patch) + 1}`;
        } else {
          versionNumber = "1.0.0";
        }
      } else {
        versionNumber = "1.0.0";
      }

      if (createVersionDto.isDraft) {
        versionNumber += "-rc1";
      }
    }

    if (createVersionDto.updateExisting && createVersionDto.versionId) {
      this.logger.info(
        `🔄 UPDATE PATH: Updating existing version ${createVersionDto.versionId} directly for assignment ${assignmentId}`,
        {
          versionId: createVersionDto.versionId,
          versionNumber: createVersionDto.versionNumber,
          versionDescription: createVersionDto.versionDescription,
        },
      );
      return await this.updateExistingVersion(
        assignmentId,
        createVersionDto.versionId,
        createVersionDto,
        userSession,
      );
    }

    const originalVersionNumber = versionNumber;
    const finalVersionNumber = versionNumber;
    const wasAutoIncremented = false;

    const existingVersion = await this.prisma.assignmentVersion.findFirst({
      where: {
        assignmentId,
        versionNumber: finalVersionNumber,
      },
      include: { _count: { select: { questionVersions: true } } },
    });

    if (existingVersion) {
      if (createVersionDto.updateExisting) {
        this.logger.info(
          `Updating existing version ${existingVersion.id} found by version number ${finalVersionNumber}`,
        );
        return await this.updateExistingVersion(
          assignmentId,
          existingVersion.id,
          createVersionDto,
          userSession,
        );
      } else {
        const versionExistsError = new ConflictException({
          message: `Version ${finalVersionNumber} already exists for this assignment`,
          versionExists: true,
          existingVersion: {
            id: existingVersion.id,
            versionNumber: existingVersion.versionNumber,
            versionDescription: existingVersion.versionDescription,
            isDraft: existingVersion.isDraft,
            isActive: existingVersion.isActive,
            published: existingVersion.published,
            createdBy: existingVersion.createdBy,
            createdAt: existingVersion.createdAt,
            questionCount: existingVersion._count.questionVersions,
          },
        });
        throw versionExistsError;
      }
    }

    versionNumber = finalVersionNumber;

    return await this.prisma.$transaction(async (tx) => {
      const assignmentVersion = await tx.assignmentVersion.create({
        data: {
          assignmentId,
          versionNumber,
          name: assignment.name,
          introduction: assignment.introduction,
          instructions: assignment.instructions,
          gradingCriteriaOverview: assignment.gradingCriteriaOverview,
          timeEstimateMinutes: assignment.timeEstimateMinutes,
          type: assignment.type,
          graded: assignment.graded,
          numAttempts: assignment.numAttempts,
          attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
          retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
          allotedTimeMinutes: assignment.allotedTimeMinutes,
          attemptsPerTimeRange: assignment.attemptsPerTimeRange,
          attemptsTimeRangeHours: assignment.attemptsTimeRangeHours,
          passingGrade: assignment.passingGrade,
          displayOrder: assignment.displayOrder,
          questionDisplay: assignment.questionDisplay,
          numberOfQuestionsPerAttempt: questionsPerAttempt,
          questionOrder: assignment.questionOrder,
          published: !createVersionDto.isDraft,
          showAssignmentScore: assignment.showAssignmentScore,
          showQuestionScore: assignment.showQuestionScore,
          showPassFailIndicator: assignment.showPassFailIndicator,
          showSubmissionFeedback: assignment.showSubmissionFeedback,
          showQuestions: assignment.showQuestions,
          correctAnswerVisibility: assignment.correctAnswerVisibility,
          questionControls: assignment.questionControls,
          requireAllQuestions: assignment.requireAllQuestions,
          optionalQuestionIds: assignment.optionalQuestionIds,
          languageCode: assignment.languageCode,
          createdBy: userSession.userId,
          isDraft: createVersionDto.isDraft ?? true,
          versionDescription: wasAutoIncremented
            ? `${
                createVersionDto.versionDescription || ""
              } (Auto-incremented from ${originalVersionNumber} due to version conflict)`.trim()
            : createVersionDto.versionDescription,
          isActive: createVersionDto.shouldActivate ?? false,
        },
      });

      this.logger.info(
        `Creating ${assignment.questions.length} question versions for assignment version ${assignmentVersion.id}`,
      );

      const orderedQuestions = applyQuestionOrder(
        assignment.questions,
        assignment.questionOrder,
      );

      for (const [index, question] of orderedQuestions.entries()) {
        const questionVersion = await tx.questionVersion.create({
          data: {
            assignmentVersionId: assignmentVersion.id,
            questionId: question.id,
            totalPoints: question.totalPoints,
            authorComment: question.authorComment ?? null,
            type: question.type,
            responseType: question.responseType,
            question: question.question,
            maxWords: question.maxWords,
            scoring: question.scoring,
            choices: question.choices,
            randomizedChoices: question.randomizedChoices,
            answer: question.answer,
            gradingContextQuestionIds: question.gradingContextQuestionIds,
            maxCharacters: question.maxCharacters,
            videoPresentationConfig: question.videoPresentationConfig,
            liveRecordingConfig: question.liveRecordingConfig,
            displayOrder: index + 1,
          },
        });

        this.logger.debug(
          `Created question version ${questionVersion.id} for question ${
            question.id
          } (${question.question.slice(0, 50)}...)`,
        );
      }

      this.logger.info(
        `Successfully created all ${orderedQuestions.length} question versions`,
      );

      // Carry the correction back to the assignment itself, so the author's
      // config screen stops advertising a subset size that no longer exists
      // and the next version snapshots the corrected number.
      if (questionsPerAttemptWasClamped) {
        await tx.assignment.update({
          where: { id: assignmentId },
          data: { numberOfQuestionsPerAttempt: questionsPerAttempt },
        });
      }

      if (createVersionDto.shouldActivate) {
        await tx.assignmentVersion.updateMany({
          where: { assignmentId, id: { not: assignmentVersion.id } },
          data: { isActive: false },
        });

        await tx.assignment.update({
          where: { id: assignmentId },
          data: { currentVersionId: assignmentVersion.id },
        });
      }

      await tx.versionHistory.create({
        data: {
          assignmentId,
          fromVersionId: assignment.currentVersionId,
          toVersionId: assignmentVersion.id,
          action: createVersionDto.isDraft
            ? "draft_created"
            : "version_created",
          description: createVersionDto.versionDescription,
          userId: userSession.userId,
        },
      });

      this.logger.info(
        `Created version ${versionNumber} for assignment ${assignmentId}${
          wasAutoIncremented ? " (auto-incremented)" : ""
        }`,
        {
          versionId: assignmentVersion.id,
          originalVersionNumber: wasAutoIncremented
            ? originalVersionNumber
            : undefined,
        },
      );

      return {
        id: assignmentVersion.id,
        versionNumber: assignmentVersion.versionNumber,
        versionDescription: assignmentVersion.versionDescription,
        isDraft: assignmentVersion.isDraft,
        isActive: assignmentVersion.isActive,
        published: assignmentVersion.published,
        createdBy: assignmentVersion.createdBy,
        createdAt: assignmentVersion.createdAt,
        questionCount: assignment.questions.length,
        wasAutoIncremented,
        originalVersionNumber: wasAutoIncremented
          ? originalVersionNumber
          : undefined,
      };
    });
  }

  async listVersions(assignmentId: number): Promise<VersionSummary[]> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { AssignmentAuthor: true, currentVersion: true },
    });

    if (!assignment) {
      this.logger.error(`❌ Assignment ${assignmentId} not found`);
      throw new NotFoundException("Assignment not found");
    }

    const versions = await this.prisma.assignmentVersion.findMany({
      where: { assignmentId },
      include: { _count: { select: { questionVersions: true } } },
      orderBy: { createdAt: "desc" },
    });

    const versionSummaries = versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      versionDescription: version.versionDescription,
      isDraft: version.isDraft,
      isActive: version.isActive,
      published: version.published,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      questionCount: version._count.questionVersions,
    }));

    return versionSummaries;
  }

  async getVersion(
    assignmentId: number,
    versionId: number,
  ): Promise<
    AssignmentVersion & {
      questionVersions: any[];
    }
  > {
    const version = await this.prisma.assignmentVersion.findUnique({
      where: { id: versionId, assignmentId },
      include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
    });

    if (!version) {
      throw new NotFoundException("Version not found");
    }

    this.logger.info(
      `Found version ${versionId} for assignment ${assignmentId}`,
      {
        versionId: version.id,
        assignmentId: version.assignmentId,
        questionVersionsCount: version.questionVersions.length,
        questionVersions: version.questionVersions.map((qv) => ({
          id: qv.id,
          questionId: qv.questionId,
          question: qv.question?.slice(0, 50) + "...",
        })),
      },
    );

    const questionVersionsWithVariants = await Promise.all(
      version.questionVersions.map(async (qv) => {
        let variants = [];
        if (qv.questionId) {
          const originalQuestion = await this.prisma.question.findUnique({
            where: { id: qv.questionId },
            include: {
              variants: {
                where: { isDeleted: false },
              },
            },
          });
          variants = originalQuestion?.variants || [];
        }

        return {
          id: qv.id,
          questionId: qv.questionId,
          totalPoints: qv.totalPoints,
          authorComment: qv.authorComment,
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
          variants: variants.map((v) => ({
            id: v.id,
            variantContent: v.variantContent,
            choices: v.choices,
            scoring: v.scoring,
            maxWords: v.maxWords,
            maxCharacters: v.maxCharacters,
            variantType: v.variantType,
            randomizedChoices: v.randomizedChoices,
            isDeleted: v.isDeleted,
            answer: v.answer,
          })),
        };
      }),
    );

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      versionDescription: version.versionDescription,
      isDraft: version.isDraft,
      isActive: version.isActive,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      assignmentId: version.assignmentId,
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
      showPassFailIndicator: version.showPassFailIndicator,
      showSubmissionFeedback: version.showSubmissionFeedback,
      showQuestions: version.showQuestions,
      correctAnswerVisibility: version.correctAnswerVisibility,
      questionControls: version.questionControls,
      requireAllQuestions: version.requireAllQuestions,
      optionalQuestionIds: version.optionalQuestionIds,
      languageCode: version.languageCode,
      questionVersions: questionVersionsWithVariants,
    };
  }

  async saveDraft(
    assignmentId: number,
    saveDraftDto: SaveDraftDto,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(`Saving draft for assignment ${assignmentId}`, {
      userId: userSession.userId,
    });

    const existingDraft = await this.prisma.assignmentVersion.findFirst({
      where: {
        assignmentId,
        isDraft: true,
        createdBy: userSession.userId,
      },
      orderBy: { createdAt: "desc" },
    });

    return await (existingDraft
      ? this.updateExistingDraft(existingDraft.id, saveDraftDto)
      : this.createDraftVersion(assignmentId, saveDraftDto, userSession));
  }

  async restoreVersion(
    assignmentId: number,
    restoreVersionDto: RestoreVersionDto,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(
      `Restoring version ${restoreVersionDto.versionId} for assignment ${assignmentId}`,
      {
        userId: userSession.userId,
      },
    );

    const versionToRestore = await this.prisma.assignmentVersion.findUnique({
      where: { id: restoreVersionDto.versionId, assignmentId },
      include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
    });

    if (!versionToRestore) {
      throw new NotFoundException("Version to restore not found");
    }

    const restoredSummary = await this.prisma.$transaction(async (tx) => {
      if (restoreVersionDto.createAsNewVersion) {
        const nextVersionNumber = await this.getNextVersionNumber(
          assignmentId,
          tx,
        );

        const restoredVersion = await tx.assignmentVersion.create({
          data: {
            assignmentId,
            versionNumber: nextVersionNumber,
            name: versionToRestore.name,
            introduction: versionToRestore.introduction,
            instructions: versionToRestore.instructions,
            gradingCriteriaOverview: versionToRestore.gradingCriteriaOverview,
            timeEstimateMinutes: versionToRestore.timeEstimateMinutes,
            type: versionToRestore.type,
            graded: versionToRestore.graded,
            numAttempts: versionToRestore.numAttempts,
            attemptsBeforeCoolDown: versionToRestore.attemptsBeforeCoolDown,
            retakeAttemptCoolDownMinutes:
              versionToRestore.retakeAttemptCoolDownMinutes,
            allotedTimeMinutes: versionToRestore.allotedTimeMinutes,
            attemptsPerTimeRange: versionToRestore.attemptsPerTimeRange,
            attemptsTimeRangeHours: versionToRestore.attemptsTimeRangeHours,
            passingGrade: versionToRestore.passingGrade,
            displayOrder: versionToRestore.displayOrder,
            questionDisplay: versionToRestore.questionDisplay,
            numberOfQuestionsPerAttempt:
              versionToRestore.numberOfQuestionsPerAttempt,
            questionOrder: versionToRestore.questionOrder,
            published: false,
            showAssignmentScore: versionToRestore.showAssignmentScore,
            showQuestionScore: versionToRestore.showQuestionScore,
            showPassFailIndicator: versionToRestore.showPassFailIndicator,
            showSubmissionFeedback: versionToRestore.showSubmissionFeedback,
            showQuestions: versionToRestore.showQuestions,
            correctAnswerVisibility: versionToRestore.correctAnswerVisibility,
            requireAllQuestions: versionToRestore.requireAllQuestions,
            optionalQuestionIds: versionToRestore.optionalQuestionIds,
            languageCode: versionToRestore.languageCode,
            createdBy: userSession.userId,
            isDraft: true,
            versionDescription:
              restoreVersionDto.versionDescription ||
              `Restored from version ${versionToRestore.versionNumber}`,
            isActive: false,
          },
        });

        for (const questionVersion of versionToRestore.questionVersions) {
          await tx.questionVersion.create({
            data: {
              assignmentVersionId: restoredVersion.id,
              questionId: questionVersion.questionId,
              authorComment: questionVersion.authorComment ?? null,
              totalPoints: questionVersion.totalPoints,
              type: questionVersion.type,
              responseType: questionVersion.responseType,
              question: questionVersion.question,
              maxWords: questionVersion.maxWords,
              scoring: questionVersion.scoring,
              choices: questionVersion.choices,
              randomizedChoices: questionVersion.randomizedChoices,
              answer: questionVersion.answer,
              gradingContextQuestionIds:
                questionVersion.gradingContextQuestionIds,
              maxCharacters: questionVersion.maxCharacters,
              videoPresentationConfig: questionVersion.videoPresentationConfig,
              liveRecordingConfig: questionVersion.liveRecordingConfig,
              displayOrder: questionVersion.displayOrder,
            },
          });
        }

        await tx.versionHistory.create({
          data: {
            assignmentId,
            fromVersionId: versionToRestore.id,
            toVersionId: restoredVersion.id,
            action: "version_restored",
            description: `Restored from version ${versionToRestore.versionNumber}`,
            userId: userSession.userId,
          },
        });

        return {
          id: restoredVersion.id,
          versionNumber: restoredVersion.versionNumber,
          versionDescription: restoredVersion.versionDescription,
          isDraft: restoredVersion.isDraft,
          isActive: restoredVersion.isActive,
          published: restoredVersion.published,
          createdBy: restoredVersion.createdBy,
          createdAt: restoredVersion.createdAt,
          questionCount: versionToRestore.questionVersions.length,
        };
      } else {
        const isRcVersion = /-rc\d+$/.test(versionToRestore.versionNumber);

        if (isRcVersion) {
          return await this.activateRcVersion(
            assignmentId,
            restoreVersionDto.versionId,
            userSession,
            tx,
          );
        } else {
          if (!versionToRestore.published) {
            throw new BadRequestException(
              `Version ${versionToRestore.versionNumber} cannot be activated because it has not been published yet. Please publish the version first before activating it.`,
            );
          }

          await tx.assignmentVersion.updateMany({
            where: { assignmentId },
            data: { isActive: false },
          });

          await tx.assignmentVersion.update({
            where: { id: restoreVersionDto.versionId },
            data: { isActive: true },
          });

          await tx.assignment.update({
            where: { id: assignmentId },
            data: { currentVersionId: restoreVersionDto.versionId },
          });

          await tx.versionHistory.create({
            data: {
              assignmentId,
              fromVersionId: null,
              toVersionId: restoreVersionDto.versionId,
              action: "version_activated",
              description: `Activated version ${versionToRestore.versionNumber}`,
              userId: userSession.userId,
            },
          });

          return {
            id: versionToRestore.id,
            versionNumber: versionToRestore.versionNumber,
            versionDescription: versionToRestore.versionDescription,
            isDraft: versionToRestore.isDraft,
            isActive: true,
            published: versionToRestore.published,
            createdBy: versionToRestore.createdBy,
            createdAt: versionToRestore.createdAt,
            questionCount: versionToRestore.questionVersions.length,
          };
        }
      }
    });

    // Activating a version changes which questions and metadata learners
    // receive, so the cached attempt-access payload for this assignment must be
    // dropped. Creating a draft (isActive=false) leaves the active version
    // untouched and needs no invalidation. Cache failures are non-fatal — the
    // entries self-expire — so we log and continue rather than fail the restore.
    if (restoredSummary.isActive) {
      try {
        await this.attemptAccessCache.invalidateForAssignment(assignmentId);
      } catch (cacheError) {
        this.logger.warn(
          `Failed to invalidate attempt-access cache after restoring version ` +
            `for assignment ${assignmentId}: ${
              cacheError instanceof Error ? cacheError.message : "Unknown error"
            }`,
        );
      }
    }

    return restoredSummary;
  }

  async publishVersion(
    assignmentId: number,
    versionId: number,
    options: { shouldActivate?: boolean; userSession?: UserSession } = {},
  ): Promise<VersionSummary> {
    const { shouldActivate = true, userSession } = options;

    const version = await this.prisma.assignmentVersion.findUnique({
      where: { id: versionId, assignmentId },
      include: { _count: { select: { questionVersions: true } } },
    });

    if (!version) {
      throw new NotFoundException(
        `Version with ID ${versionId} not found for assignment ${assignmentId}`,
      );
    }

    if (version.published) {
      throw new BadRequestException(
        `Version ${version.versionNumber} is already published`,
      );
    }

    // Same correction as createVersion, but against this version's own
    // snapshot — a version can reach publish without going through
    // createVersion's clamp (restored versions, drafts promoted later). Fold
    // it down as part of publishing so the row matches what attempt creation
    // will actually serve.
    const clampedPerAttempt = clampQuestionsPerAttempt(
      version.numberOfQuestionsPerAttempt,
      version._count.questionVersions,
    );
    const perAttemptWasClamped =
      clampedPerAttempt !== version.numberOfQuestionsPerAttempt;

    if (perAttemptWasClamped) {
      this.logger.warn(
        `Publish: version's numberOfQuestionsPerAttempt clamped to its question pool`,
        {
          assignmentId,
          versionId,
          numberOfQuestionsPerAttempt: version.numberOfQuestionsPerAttempt,
          availableQuestions: version._count.questionVersions,
          clampedPerAttempt,
          userId: userSession?.userId,
        },
      );
    }

    let publishedVersionNumber = version.versionNumber;
    if (publishedVersionNumber.includes("-rc")) {
      publishedVersionNumber = publishedVersionNumber.replace(/-rc\d+$/, "");

      const existingPublishedVersion =
        await this.prisma.assignmentVersion.findFirst({
          where: {
            assignmentId,
            versionNumber: publishedVersionNumber,
            id: { not: versionId },
          },
        });

      if (existingPublishedVersion) {
        const versionMatch = publishedVersionNumber.match(
          /^(\d+)\.(\d+)\.(\d+)$/,
        );
        if (versionMatch) {
          const [, major, minor, patch] = versionMatch;
          let newPatch = Number.parseInt(patch) + 1;
          let newVersionNumber = `${major}.${minor}.${newPatch}`;

          while (
            await this.prisma.assignmentVersion.findFirst({
              where: {
                assignmentId,
                versionNumber: newVersionNumber,
                id: { not: versionId },
              },
            })
          ) {
            newPatch++;
            newVersionNumber = `${major}.${minor}.${newPatch}`;
          }

          publishedVersionNumber = newVersionNumber;
          this.logger.info(
            `Resolved version conflict by incrementing patch: ${version.versionNumber} → ${publishedVersionNumber}`,
          );
        } else {
          throw new ConflictException(
            `Published version ${publishedVersionNumber} already exists and version format is not recognizable.`,
          );
        }
      }
    }

    const originalVersionNumber = version.versionNumber;
    const wasAutoIncremented =
      publishedVersionNumber !== originalVersionNumber.replace(/-rc\d+$/, "");

    // Capture the currently-active version (if any) so the audit trail records
    // the actual transition. Read outside the transaction — this is purely
    // informational for VersionHistory.fromVersionId.
    const previouslyActive = shouldActivate
      ? await this.prisma.assignmentVersion.findFirst({
          where: { assignmentId, isActive: true, id: { not: versionId } },
          select: { id: true },
        })
      : null;

    // Publish (and optionally activate) atomically. Without this transaction,
    // a concurrent activation/restoration could observe a partial state where
    // two versions are both isActive=true, or the assignment's currentVersionId
    // points at a version whose other flags haven't been updated yet.
    const updatedVersion = await this.prisma.$transaction(async (tx) => {
      const published = await tx.assignmentVersion.update({
        where: { id: versionId },
        data: {
          published: true,
          isDraft: false,
          versionNumber: publishedVersionNumber,
          ...(perAttemptWasClamped
            ? { numberOfQuestionsPerAttempt: clampedPerAttempt }
            : {}),
          versionDescription: wasAutoIncremented
            ? `${
                version.versionDescription || ""
              } (Auto-incremented from ${originalVersionNumber} due to version conflict)`.trim()
            : version.versionDescription,
        },
        include: { _count: { select: { questionVersions: true } } },
      });

      if (!shouldActivate) {
        return published;
      }

      // Deactivate every other version for this assignment, then activate
      // the just-published one. The `id: { not: versionId }` clause guards
      // against an extra round-trip if the caller ever passes a versionId
      // that was already active for some reason.
      await tx.assignmentVersion.updateMany({
        where: { assignmentId, id: { not: versionId } },
        data: { isActive: false },
      });
      const activated = await tx.assignmentVersion.update({
        where: { id: versionId },
        data: { isActive: true },
        include: { _count: { select: { questionVersions: true } } },
      });
      await tx.assignment.update({
        where: { id: assignmentId },
        data: { currentVersionId: versionId },
      });
      await tx.versionHistory.create({
        data: {
          assignmentId,
          fromVersionId: previouslyActive?.id ?? null,
          toVersionId: versionId,
          action: "version_activated",
          description: `Activated version ${publishedVersionNumber}${
            wasAutoIncremented
              ? ` (auto-incremented from ${originalVersionNumber})`
              : ""
          }`,
          userId: userSession?.userId ?? version.createdBy,
        },
      });
      return activated;
    });

    this.logger.info(
      `Successfully published version: ${originalVersionNumber} → ${publishedVersionNumber}${
        wasAutoIncremented ? " (auto-incremented)" : ""
      }${shouldActivate ? " (activated)" : ""}`,
    );

    return {
      id: updatedVersion.id,
      versionNumber: updatedVersion.versionNumber,
      versionDescription: updatedVersion.versionDescription,
      isDraft: updatedVersion.isDraft,
      isActive: updatedVersion.isActive,
      published: updatedVersion.published,
      createdBy: updatedVersion.createdBy,
      createdAt: updatedVersion.createdAt,
      questionCount: updatedVersion._count.questionVersions,
      wasAutoIncremented,
      originalVersionNumber: wasAutoIncremented
        ? originalVersionNumber
        : undefined,
    };
  }

  async compareVersions(
    assignmentId: number,
    compareDto: CompareVersionsDto,
  ): Promise<VersionComparison> {
    const [fromVersion, toVersion] = await Promise.all([
      this.prisma.assignmentVersion.findUnique({
        where: { id: compareDto.fromVersionId, assignmentId },
        include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
      }),
      this.prisma.assignmentVersion.findUnique({
        where: { id: compareDto.toVersionId, assignmentId },
        include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
      }),
    ]);

    if (!fromVersion || !toVersion) {
      throw new NotFoundException("One or both versions not found");
    }

    const assignmentChanges = this.compareAssignmentData(
      fromVersion,
      toVersion,
    );
    const questionChanges = this.compareQuestionData(
      fromVersion.questionVersions,
      toVersion.questionVersions,
    );

    return {
      fromVersion: {
        id: fromVersion.id,
        versionNumber: fromVersion.versionNumber,
        versionDescription: fromVersion.versionDescription,
        isDraft: fromVersion.isDraft,
        isActive: fromVersion.isActive,
        published: fromVersion.published,
        createdBy: fromVersion.createdBy,
        createdAt: fromVersion.createdAt,
        questionCount: fromVersion.questionVersions.length,
      },
      toVersion: {
        id: toVersion.id,
        versionNumber: toVersion.versionNumber,
        versionDescription: toVersion.versionDescription,
        isDraft: toVersion.isDraft,
        isActive: toVersion.isActive,
        published: toVersion.published,
        createdBy: toVersion.createdBy,
        createdAt: toVersion.createdAt,
        questionCount: toVersion.questionVersions.length,
      },
      assignmentChanges,
      questionChanges,
    };
  }

  async getVersionHistory(assignmentId: number, _userSession: UserSession) {
    void _userSession;
    return await this.prisma.versionHistory.findMany({
      where: { assignmentId },
      include: {
        fromVersion: { select: { versionNumber: true } },
        toVersion: { select: { versionNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async updateExistingDraft(
    draftId: number,
    saveDraftDto: SaveDraftDto,
  ): Promise<VersionSummary> {
    return await this.prisma.$transaction(async (tx) => {
      const updatedDraft = await tx.assignmentVersion.update({
        where: { id: draftId },
        data: {
          versionDescription: saveDraftDto.versionDescription,
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
          ...(saveDraftDto.assignmentData?.requireAllQuestions !==
            undefined && {
            requireAllQuestions:
              saveDraftDto.assignmentData.requireAllQuestions,
          }),
          ...(saveDraftDto.assignmentData?.optionalQuestionIds !==
            undefined && {
            optionalQuestionIds:
              saveDraftDto.assignmentData.optionalQuestionIds,
          }),
          ...(saveDraftDto.assignmentData?.timeEstimateMinutes && {
            timeEstimateMinutes:
              saveDraftDto.assignmentData.timeEstimateMinutes,
          }),
        },
        include: { _count: { select: { questionVersions: true } } },
      });

      await tx.questionVersion.deleteMany({
        where: { assignmentVersionId: draftId },
      });

      if (saveDraftDto.questionsData && saveDraftDto.questionsData.length > 0) {
        for (const [
          index,
          questionData,
        ] of saveDraftDto.questionsData.entries()) {
          await tx.questionVersion.create({
            data: {
              assignmentVersionId: draftId,
              questionId: questionData.id || null,
              authorComment: questionData.authorComment ?? null,
              totalPoints: questionData.totalPoints || 0,
              type: questionData.type,
              responseType: questionData.responseType,
              question: questionData.question,
              maxWords: questionData.maxWords,
              scoring: questionData.scoring as any,
              choices: questionData.choices as any,
              randomizedChoices: questionData.randomizedChoices,
              answer: questionData.answer,
              gradingContextQuestionIds:
                questionData.gradingContextQuestionIds || [],
              maxCharacters: questionData.maxCharacters,
              videoPresentationConfig:
                questionData.videoPresentationConfig as any,
              liveRecordingConfig: questionData.liveRecordingConfig,
              displayOrder: index + 1,
            },
          });
        }
      }

      return {
        id: updatedDraft.id,
        versionNumber: updatedDraft.versionNumber,
        versionDescription: updatedDraft.versionDescription,
        isDraft: updatedDraft.isDraft,
        isActive: updatedDraft.isActive,
        published: updatedDraft.published,
        createdBy: updatedDraft.createdBy,
        createdAt: updatedDraft.createdAt,
        questionCount: saveDraftDto.questionsData?.length || 0,
      };
    });
  }

  private async updateExistingVersion(
    assignmentId: number,
    versionId: number,
    updateData: CreateVersionDto,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(
      `🔄 UPDATE EXISTING VERSION: Starting update for version ${versionId} on assignment ${assignmentId}`,
      {
        versionId,
        assignmentId,
        updateData,
        userId: userSession.userId,
      },
    );

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: { where: { isDeleted: false } },
      },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    return await this.prisma.$transaction(async (tx) => {
      const updatedVersion = await tx.assignmentVersion.update({
        where: { id: versionId },
        data: {
          versionDescription: updateData.versionDescription,
          isDraft: updateData.isDraft ?? true,
          isActive: updateData.shouldActivate ?? false,
          published: !(updateData.isDraft ?? true),
          name: assignment.name,
          introduction: assignment.introduction,
          instructions: assignment.instructions,
          gradingCriteriaOverview: assignment.gradingCriteriaOverview,
          timeEstimateMinutes: assignment.timeEstimateMinutes,
          type: assignment.type,
          graded: assignment.graded,
          numAttempts: assignment.numAttempts,
          attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
          retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
          allotedTimeMinutes: assignment.allotedTimeMinutes,
          attemptsPerTimeRange: assignment.attemptsPerTimeRange,
          attemptsTimeRangeHours: assignment.attemptsTimeRangeHours,
          passingGrade: assignment.passingGrade,
          displayOrder: assignment.displayOrder,
          questionDisplay: assignment.questionDisplay,
          numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
          questionOrder: assignment.questionOrder,
          showAssignmentScore: assignment.showAssignmentScore,
          showQuestionScore: assignment.showQuestionScore,
          showPassFailIndicator: assignment.showPassFailIndicator,
          showSubmissionFeedback: assignment.showSubmissionFeedback,
          showQuestions: assignment.showQuestions,
          correctAnswerVisibility: assignment.correctAnswerVisibility,
          questionControls: assignment.questionControls,
          requireAllQuestions: assignment.requireAllQuestions,
          optionalQuestionIds: assignment.optionalQuestionIds,
          languageCode: assignment.languageCode,
        },
        include: { _count: { select: { questionVersions: true } } },
      });

      await tx.questionVersion.deleteMany({
        where: { assignmentVersionId: versionId },
      });

      const orderedQuestions = applyQuestionOrder(
        assignment.questions,
        assignment.questionOrder,
      );

      for (const [index, question] of orderedQuestions.entries()) {
        await tx.questionVersion.create({
          data: {
            assignmentVersionId: versionId,
            questionId: question.id,
            authorComment: question.authorComment ?? null,
            totalPoints: question.totalPoints,
            type: question.type,
            responseType: question.responseType,
            question: question.question,
            maxWords: question.maxWords,
            scoring: question.scoring,
            choices: question.choices,
            randomizedChoices: question.randomizedChoices,
            answer: question.answer,
            gradingContextQuestionIds: question.gradingContextQuestionIds,
            maxCharacters: question.maxCharacters,
            videoPresentationConfig: question.videoPresentationConfig,
            liveRecordingConfig: question.liveRecordingConfig,
            displayOrder: index + 1,
          },
        });
      }

      if (updateData.shouldActivate) {
        await tx.assignmentVersion.updateMany({
          where: { assignmentId, id: { not: versionId } },
          data: { isActive: false },
        });

        await tx.assignment.update({
          where: { id: assignmentId },
          data: { currentVersionId: versionId },
        });
      }

      await tx.versionHistory.create({
        data: {
          assignmentId,
          toVersionId: versionId,
          action: "version_updated",
          description: `Version ${updatedVersion.versionNumber} updated: ${updateData.versionDescription}`,
          userId: userSession.userId,
        },
      });

      this.logger.info(
        `✅ UPDATE EXISTING VERSION: Successfully updated version ${updatedVersion.versionNumber} (ID: ${updatedVersion.id}) for assignment ${assignmentId}`,
      );

      return {
        id: updatedVersion.id,
        versionNumber: updatedVersion.versionNumber,
        versionDescription: updatedVersion.versionDescription,
        isDraft: updatedVersion.isDraft,
        isActive: updatedVersion.isActive,
        published: updatedVersion.published,
        createdBy: updatedVersion.createdBy,
        createdAt: updatedVersion.createdAt,
        questionCount: assignment.questions.length,
      };
    });
  }

  private async getNextVersionNumber(
    assignmentId: number,
    tx: any,
  ): Promise<string> {
    const lastVersion = await tx.assignmentVersion.findFirst({
      where: { assignmentId },
      orderBy: { createdAt: "desc" },
    });

    if (!lastVersion || !lastVersion.versionNumber) {
      return "1.0.0";
    }

    if (/^\d+\.\d+\.\d+(-rc\d+)?$/.test(lastVersion.versionNumber)) {
      const match = lastVersion.versionNumber.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        const major = Number.parseInt(match[1], 10);
        const minor = Number.parseInt(match[2], 10);
        const patch = Number.parseInt(match[3], 10) + 1;
        return `${major}.${minor}.${patch}`;
      }
    }

    return "1.0.0";
  }

  private compareAssignmentData(from: any, to: any) {
    const changes = [];
    const fields = [
      "name",
      "introduction",
      "instructions",
      "gradingCriteriaOverview",
      "published",
    ];

    for (const field of fields) {
      if (from[field] !== to[field]) {
        changes.push({
          field,
          fromValue: from[field],
          toValue: to[field],
          changeType:
            from[field] === null
              ? "added"
              : to[field] === null
                ? "removed"
                : "modified",
        });
      }
    }
    return changes;
  }

  private compareQuestionData(fromQuestions: any[], toQuestions: any[]) {
    const changes = [];

    const fromMap = new Map(
      fromQuestions.map((q) => [q.questionId || q.id, q]),
    );
    const toMap = new Map(toQuestions.map((q) => [q.questionId || q.id, q]));

    for (const [questionId, question] of toMap) {
      if (!fromMap.has(questionId)) {
        changes.push({
          questionId,
          displayOrder: question.displayOrder,
          changeType: "added" as const,
        });
      }
    }

    for (const [questionId, question] of fromMap) {
      if (!toMap.has(questionId)) {
        changes.push({
          questionId,
          displayOrder: question.displayOrder,
          changeType: "removed" as const,
        });
      }
    }

    for (const [questionId, fromQuestion] of fromMap) {
      const toQuestion = toMap.get(questionId);
      if (toQuestion) {
        const fieldsToCompare = [
          "question",
          "totalPoints",
          "type",
          "responseType",
          "scoring",
          "choices",
        ];

        for (const field of fieldsToCompare) {
          const fromValue = fromQuestion[field];
          const toValue = toQuestion[field];

          const fromString =
            typeof fromValue === "object"
              ? JSON.stringify(fromValue)
              : fromValue;
          const toString_ =
            typeof toValue === "object" ? JSON.stringify(toValue) : toValue;

          if (fromString !== toString_) {
            changes.push({
              questionId,
              displayOrder: toQuestion.displayOrder,
              changeType: "modified" as const,
              field,
              fromValue,
              toValue,
            });
          }
        }
      }
    }

    return changes;
  }

  private async createDraftVersion(
    assignmentId: number,
    saveDraftDto: SaveDraftDto,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { AssignmentAuthor: true },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    return await this.prisma.$transaction(async (tx) => {
      const lastVersion = await tx.assignmentVersion.findFirst({
        where: { assignmentId },
        orderBy: { createdAt: "desc" },
      });

      let nextVersionNumber = "1.0.0-rc1";
      if (lastVersion && lastVersion.versionNumber) {
        if (/^\d+\.\d+\.\d+(-rc\d+)?$/.test(lastVersion.versionNumber)) {
          const rcMatch = lastVersion.versionNumber.match(/-rc(\d+)$/);
          if (rcMatch) {
            const baseVersion = lastVersion.versionNumber.replace(
              /-rc\d+$/,
              "",
            );
            const rcNumber = Number.parseInt(rcMatch[1], 10) + 1;
            nextVersionNumber = `${baseVersion}-rc${rcNumber}`;
          } else {
            nextVersionNumber = `${lastVersion.versionNumber}-rc1`;
          }
        } else {
          nextVersionNumber = "1.0.0-rc1";
        }
      }

      const assignmentVersion = await tx.assignmentVersion.create({
        data: {
          assignmentId,
          versionNumber: nextVersionNumber,
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
          graded: assignment.graded,
          numAttempts: assignment.numAttempts,
          attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
          retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
          allotedTimeMinutes: assignment.allotedTimeMinutes,
          attemptsPerTimeRange: assignment.attemptsPerTimeRange,
          attemptsTimeRangeHours: assignment.attemptsTimeRangeHours,
          passingGrade: assignment.passingGrade,
          displayOrder: assignment.displayOrder,
          questionDisplay: assignment.questionDisplay,
          numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
          questionOrder: assignment.questionOrder,
          published: false,
          showAssignmentScore: assignment.showAssignmentScore,
          showQuestionScore: assignment.showQuestionScore,
          showPassFailIndicator: assignment.showPassFailIndicator,
          showSubmissionFeedback: assignment.showSubmissionFeedback,
          showQuestions: assignment.showQuestions,
          correctAnswerVisibility: assignment.correctAnswerVisibility,
          questionControls: assignment.questionControls,
          requireAllQuestions: assignment.requireAllQuestions,
          optionalQuestionIds: assignment.optionalQuestionIds,
          languageCode: assignment.languageCode,
          createdBy: userSession.userId,
          isDraft: true,
          versionDescription:
            saveDraftDto.versionDescription || "Draft version",
          isActive: false,
        },
      });

      if (saveDraftDto.questionsData && saveDraftDto.questionsData.length > 0) {
        for (const [
          index,
          questionData,
        ] of saveDraftDto.questionsData.entries()) {
          await tx.questionVersion.create({
            data: {
              assignmentVersionId: assignmentVersion.id,
              questionId: questionData.id || null,
              authorComment: questionData.authorComment ?? null,
              totalPoints: questionData.totalPoints || 0,
              type: questionData.type,
              responseType: questionData.responseType,
              question: questionData.question,
              maxWords: questionData.maxWords,
              scoring: questionData.scoring as any,
              choices: questionData.choices as any,
              randomizedChoices: questionData.randomizedChoices,
              answer: questionData.answer,
              gradingContextQuestionIds:
                questionData.gradingContextQuestionIds || [],
              maxCharacters: questionData.maxCharacters,
              videoPresentationConfig:
                questionData.videoPresentationConfig as any,
              liveRecordingConfig: questionData.liveRecordingConfig,
              displayOrder: index + 1,
            },
          });
        }
      }

      await tx.versionHistory.create({
        data: {
          assignmentId,
          toVersionId: assignmentVersion.id,
          action: "draft_created",
          description: saveDraftDto.versionDescription,
          userId: userSession.userId,
        },
      });

      return {
        id: assignmentVersion.id,
        versionNumber: assignmentVersion.versionNumber,
        versionDescription: assignmentVersion.versionDescription,
        isDraft: assignmentVersion.isDraft,
        isActive: assignmentVersion.isActive,
        published: assignmentVersion.published,
        createdBy: assignmentVersion.createdBy,
        createdAt: assignmentVersion.createdAt,
        questionCount: saveDraftDto.questionsData?.length || 0,
      };
    });
  }

  async getUserLatestDraft(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<{
    questions: any[];
    _isDraftVersion: boolean;
    _draftVersionId: number | null;
    id: number;
    name: string;
    introduction: string | null;
    instructions: string | null;
    gradingCriteriaOverview: string | null;
    timeEstimateMinutes: number | null;
    type: string;
    graded: boolean;
    numAttempts: number | null;
    attemptsBeforeCoolDown: number | null;
    retakeAttemptCoolDownMinutes: number | null;
    allotedTimeMinutes: number | null;
    passingGrade: number | null;
    displayOrder: string | null;
    questionDisplay: string | null;
    numberOfQuestionsPerAttempt: number | null;
    questionOrder: number[] | null;
    published: boolean;
    showAssignmentScore: boolean;
    showQuestionScore: boolean;
    showPassFailIndicator: boolean;
    showSubmissionFeedback: boolean;
    showQuestions: boolean;
    correctAnswerVisibility: string;
    requireAllQuestions: boolean;
    optionalQuestionIds: number[];
    languageCode: string | null;
  }> {
    const latestDraft = await this.prisma.assignmentVersion.findFirst({
      where: {
        assignmentId,
        isDraft: true,
        createdBy: userSession.userId,
      },
      include: {
        questionVersions: { orderBy: { displayOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestDraft) {
      return null;
    }

    return {
      id: assignmentId,
      name: latestDraft.name,
      introduction: latestDraft.introduction,
      instructions: latestDraft.instructions,
      gradingCriteriaOverview: latestDraft.gradingCriteriaOverview,
      timeEstimateMinutes: latestDraft.timeEstimateMinutes,
      type: latestDraft.type,
      graded: latestDraft.graded,
      numAttempts: latestDraft.numAttempts,
      attemptsBeforeCoolDown: latestDraft.attemptsBeforeCoolDown,
      retakeAttemptCoolDownMinutes: latestDraft.retakeAttemptCoolDownMinutes,
      allotedTimeMinutes: latestDraft.allotedTimeMinutes,
      passingGrade: latestDraft.passingGrade,
      displayOrder: latestDraft.displayOrder,
      questionDisplay: latestDraft.questionDisplay,
      numberOfQuestionsPerAttempt: latestDraft.numberOfQuestionsPerAttempt,
      questionOrder: latestDraft.questionOrder,
      published: latestDraft.published,
      showAssignmentScore: latestDraft.showAssignmentScore,
      showQuestionScore: latestDraft.showQuestionScore,
      showPassFailIndicator: latestDraft.showPassFailIndicator,
      showSubmissionFeedback: latestDraft.showSubmissionFeedback,
      showQuestions: latestDraft.showQuestions,
      correctAnswerVisibility: latestDraft.correctAnswerVisibility,
      requireAllQuestions: latestDraft.requireAllQuestions,
      optionalQuestionIds: latestDraft.optionalQuestionIds,
      languageCode: latestDraft.languageCode,
      questions: latestDraft.questionVersions.map((qv) => ({
        id: qv.questionId,
        totalPoints: qv.totalPoints,
        authorComment: qv.authorComment,
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
      })),
      _isDraftVersion: true,
      _draftVersionId: latestDraft.id,
    };
  }

  async restoreDeletedQuestions(
    assignmentId: number,
    versionId: number,
    questionIds: number[],
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(
      `Restoring deleted questions ${questionIds.join(
        ", ",
      )} from version ${versionId} for assignment ${assignmentId}`,
      { userId: userSession.userId },
    );

    const sourceVersion = await this.prisma.assignmentVersion.findUnique({
      where: { id: versionId, assignmentId },
      include: {
        questionVersions: {
          where: { questionId: { in: questionIds } },
        },
      },
    });

    if (!sourceVersion) {
      throw new NotFoundException("Source version not found");
    }

    if (sourceVersion.questionVersions.length === 0) {
      throw new NotFoundException("No questions found in source version");
    }

    return await this.prisma.$transaction(async (tx) => {
      let targetDraft = await tx.assignmentVersion.findFirst({
        where: {
          assignmentId,
          isDraft: true,
          createdBy: userSession.userId,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!targetDraft) {
        const nextVersionNumber = await this.getNextVersionNumber(
          assignmentId,
          tx,
        );
        targetDraft = await tx.assignmentVersion.create({
          data: {
            assignmentId,
            versionNumber: nextVersionNumber,
            name: sourceVersion.name,
            introduction: sourceVersion.introduction,
            instructions: sourceVersion.instructions,
            gradingCriteriaOverview: sourceVersion.gradingCriteriaOverview,
            timeEstimateMinutes: sourceVersion.timeEstimateMinutes,
            type: sourceVersion.type,
            graded: sourceVersion.graded,
            numAttempts: sourceVersion.numAttempts,
            attemptsBeforeCoolDown: sourceVersion.attemptsBeforeCoolDown,
            retakeAttemptCoolDownMinutes:
              sourceVersion.retakeAttemptCoolDownMinutes,
            allotedTimeMinutes: sourceVersion.allotedTimeMinutes,
            attemptsPerTimeRange: sourceVersion.attemptsPerTimeRange,
            attemptsTimeRangeHours: sourceVersion.attemptsTimeRangeHours,
            passingGrade: sourceVersion.passingGrade,
            displayOrder: sourceVersion.displayOrder,
            questionDisplay: sourceVersion.questionDisplay,
            numberOfQuestionsPerAttempt:
              sourceVersion.numberOfQuestionsPerAttempt,
            questionOrder: sourceVersion.questionOrder,
            published: false,
            showAssignmentScore: sourceVersion.showAssignmentScore,
            showQuestionScore: sourceVersion.showQuestionScore,
            showPassFailIndicator: sourceVersion.showPassFailIndicator,
            showSubmissionFeedback: sourceVersion.showSubmissionFeedback,
            showQuestions: sourceVersion.showQuestions,
            correctAnswerVisibility: sourceVersion.correctAnswerVisibility,
            requireAllQuestions: sourceVersion.requireAllQuestions,
            optionalQuestionIds: sourceVersion.optionalQuestionIds,
            languageCode: sourceVersion.languageCode,
            createdBy: userSession.userId,
            isDraft: true,
            versionDescription: `Draft with restored questions from version ${sourceVersion.versionNumber}`,
            isActive: false,
          },
        });
      }

      for (const questionVersion of sourceVersion.questionVersions) {
        await tx.questionVersion.create({
          data: {
            assignmentVersionId: targetDraft.id,
            questionId: questionVersion.questionId,
            totalPoints: questionVersion.totalPoints,
            type: questionVersion.type,
            responseType: questionVersion.responseType,
            question: questionVersion.question,
            maxWords: questionVersion.maxWords,
            scoring: questionVersion.scoring,
            choices: questionVersion.choices,
            randomizedChoices: questionVersion.randomizedChoices,
            answer: questionVersion.answer,
            gradingContextQuestionIds:
              questionVersion.gradingContextQuestionIds,
            maxCharacters: questionVersion.maxCharacters,
            videoPresentationConfig: questionVersion.videoPresentationConfig,
            liveRecordingConfig: questionVersion.liveRecordingConfig,
            displayOrder: questionVersion.displayOrder,
          },
        });

        await tx.question.update({
          where: { id: questionVersion.questionId },
          data: { isDeleted: false },
        });
      }

      await tx.versionHistory.create({
        data: {
          assignmentId,
          fromVersionId: versionId,
          toVersionId: targetDraft.id,
          action: "questions_restored",
          description: `Restored ${questionIds.length} deleted questions from version ${sourceVersion.versionNumber}`,
          userId: userSession.userId,
        },
      });

      this.logger.info(
        `Successfully restored ${questionIds.length} questions from version ${versionId} to draft ${targetDraft.id}`,
      );

      return {
        id: targetDraft.id,
        versionNumber: targetDraft.versionNumber,
        versionDescription: targetDraft.versionDescription,
        isDraft: targetDraft.isDraft,
        isActive: targetDraft.isActive,
        published: targetDraft.published,
        createdBy: targetDraft.createdBy,
        createdAt: targetDraft.createdAt,
        questionCount: sourceVersion.questionVersions.length,
      };
    });
  }

  async updateVersionDescription(
    assignmentId: number,
    versionId: number,
    versionDescription: string,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(`Updating version description for version ${versionId}`, {
      assignmentId,
      versionId,
      userId: userSession.userId,
    });

    const version = await this.prisma.assignmentVersion.findFirst({
      where: {
        id: versionId,
        assignmentId: assignmentId,
      },
    });

    if (!version) {
      throw new NotFoundException("Version not found");
    }

    const updatedVersion = await this.prisma.assignmentVersion.update({
      where: { id: versionId },
      data: { versionDescription },
      include: {
        questionVersions: true,
      },
    });

    this.logger.info(
      `Successfully updated version description for version ${versionId}`,
    );

    return {
      id: updatedVersion.id,
      versionNumber: updatedVersion.versionNumber,
      versionDescription: updatedVersion.versionDescription,
      isDraft: updatedVersion.isDraft,
      isActive: updatedVersion.isActive,
      published: updatedVersion.published,
      createdBy: updatedVersion.createdBy,
      createdAt: updatedVersion.createdAt,
      questionCount: updatedVersion.questionVersions.length,
    };
  }

  async updateVersionNumber(
    assignmentId: number,
    versionId: number,
    versionNumber: string,
    userSession: UserSession,
  ): Promise<VersionSummary> {
    this.logger.info(`Updating version number for version ${versionId}`, {
      assignmentId,
      versionId,
      newVersionNumber: versionNumber,
      userId: userSession.userId,
    });

    const version = await this.prisma.assignmentVersion.findFirst({
      where: {
        id: versionId,
        assignmentId: assignmentId,
      },
    });

    if (!version) {
      throw new NotFoundException("Version not found");
    }

    const existingVersion = await this.prisma.assignmentVersion.findFirst({
      where: {
        assignmentId: assignmentId,
        versionNumber: versionNumber,
        id: { not: versionId },
      },
    });

    if (existingVersion) {
      throw new BadRequestException(
        `Version number "${versionNumber}" already exists for this assignment`,
      );
    }

    const updatedVersion = await this.prisma.assignmentVersion.update({
      where: { id: versionId },
      data: { versionNumber },
      include: {
        questionVersions: true,
      },
    });

    this.logger.info(
      `Successfully updated version number for version ${versionId} to ${versionNumber}`,
    );

    return {
      id: updatedVersion.id,
      versionNumber: updatedVersion.versionNumber,
      versionDescription: updatedVersion.versionDescription,
      isDraft: updatedVersion.isDraft,
      isActive: updatedVersion.isActive,
      published: updatedVersion.published,
      createdBy: updatedVersion.createdBy,
      createdAt: updatedVersion.createdAt,
      questionCount: updatedVersion.questionVersions.length,
    };
  }

  async deleteVersion(
    assignmentId: number,
    versionId: number,
    userSession: UserSession,
  ): Promise<void> {
    this.logger.info(
      `Deleting version ${versionId} for assignment ${assignmentId}`,
      {
        assignmentId,
        versionId,
        userId: userSession.userId,
      },
    );

    const version = await this.prisma.assignmentVersion.findFirst({
      where: {
        id: versionId,
        assignmentId: assignmentId,
      },
    });

    if (!version) {
      throw new NotFoundException("Version not found");
    }

    if (version.isActive) {
      throw new BadRequestException("Cannot delete the active version");
    }

    await this.prisma.$transaction(async (prisma) => {
      await prisma.questionVersion.deleteMany({
        where: { assignmentVersionId: versionId },
      });

      await prisma.assignmentVersion.delete({
        where: { id: versionId },
      });

      this.logger.info(`Successfully deleted version ${versionId}`, {
        assignmentId,
        versionId,
        userId: userSession.userId,
      });
    });
  }

  /**
   * Save assignment snapshot as a draft version
   */
  /**
   * Activate an RC version by publishing it as a final version and then activating it
   */
  private async activateRcVersion(
    assignmentId: number,
    rcVersionId: number,
    userSession: UserSession,
    tx?: Prisma.TransactionClient,
  ): Promise<VersionSummary> {
    const prisma = tx || this.prisma;

    this.logger.info(
      `🚀 ACTIVATE RC VERSION: Starting for RC version ${rcVersionId}`,
      {
        assignmentId,
        rcVersionId,
        userId: userSession.userId,
      },
    );

    const rcVersion = await prisma.assignmentVersion.findUnique({
      where: { id: rcVersionId, assignmentId },
      include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
    });

    if (!rcVersion) {
      throw new NotFoundException("RC version not found");
    }

    if (!/-rc\d+$/.test(rcVersion.versionNumber)) {
      throw new BadRequestException("Version is not an RC version");
    }

    let finalVersionNumber = rcVersion.versionNumber.replace(/-rc\d+$/, "");

    const existingFinalVersion = await prisma.assignmentVersion.findFirst({
      where: {
        assignmentId,
        versionNumber: finalVersionNumber,
        id: { not: rcVersionId },
      },
    });

    if (existingFinalVersion) {
      const versionMatch = finalVersionNumber.match(/^(\d+)\.(\d+)\.(\d+)$/);
      if (versionMatch) {
        const [, major, minor, patch] = versionMatch;
        let newPatch = Number.parseInt(patch) + 1;
        let newVersionNumber = `${major}.${minor}.${newPatch}`;

        while (
          await prisma.assignmentVersion.findFirst({
            where: {
              assignmentId,
              versionNumber: newVersionNumber,
              id: { not: rcVersionId },
            },
          })
        ) {
          newPatch++;
          newVersionNumber = `${major}.${minor}.${newPatch}`;
        }

        finalVersionNumber = newVersionNumber;
        this.logger.info(
          `Resolved version conflict by incrementing patch: ${rcVersion.versionNumber} → ${finalVersionNumber}`,
        );
      }
    }

    const operation = tx ? "within transaction" : "standalone";
    this.logger.info(`🔄 Publishing RC as final version (${operation})`, {
      originalVersion: rcVersion.versionNumber,
      finalVersion: finalVersionNumber,
    });

    const publishedVersion = await prisma.assignmentVersion.update({
      where: { id: rcVersionId },
      data: {
        versionNumber: finalVersionNumber,
        published: true,
        isDraft: false,
        versionDescription: rcVersion.versionDescription
          ? `${rcVersion.versionDescription} (Published from RC ${rcVersion.versionNumber})`
          : `Published from RC ${rcVersion.versionNumber}`,
      },
      include: { questionVersions: true },
    });

    await prisma.assignmentVersion.updateMany({
      where: { assignmentId, id: { not: rcVersionId } },
      data: { isActive: false },
    });

    await prisma.assignmentVersion.update({
      where: { id: rcVersionId },
      data: { isActive: true },
    });

    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { currentVersionId: rcVersionId },
    });

    await prisma.versionHistory.create({
      data: {
        assignmentId,
        fromVersionId: null,
        toVersionId: rcVersionId,
        action: "rc_version_activated",
        description: `RC ${rcVersion.versionNumber} published as ${finalVersionNumber} and activated`,
        userId: userSession.userId,
      },
    });

    this.logger.info(`✅ RC version activated successfully`, {
      originalVersion: rcVersion.versionNumber,
      finalVersion: finalVersionNumber,
      versionId: rcVersionId,
    });

    return {
      id: publishedVersion.id,
      versionNumber: publishedVersion.versionNumber,
      versionDescription: publishedVersion.versionDescription,
      isDraft: publishedVersion.isDraft,
      isActive: true,
      published: publishedVersion.published,
      createdBy: publishedVersion.createdBy,
      createdAt: publishedVersion.createdAt,
      questionCount: publishedVersion.questionVersions.length,
    };
  }

  async saveDraftSnapshot(
    assignmentId: number,
    draftData: {
      versionNumber: string;
      versionDescription?: string;
      assignmentData: Assignment;
      questionsData?: Question[];
    },
    userSession: UserSession,
  ): Promise<VersionSummary> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { AssignmentAuthor: true, questions: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Assignment ${assignmentId} not found`);
    }

    const existingVersion = await this.prisma.assignmentVersion.findFirst({
      where: {
        assignmentId,
        versionNumber: draftData.versionNumber,
      },
    });

    if (existingVersion) {
      throw new ConflictException(
        `Version ${draftData.versionNumber} already exists for this assignment`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let assignmentVersion: AssignmentVersion;
        try {
          assignmentVersion = await tx.assignmentVersion.create({
            data: {
              assignmentId,
              versionNumber: draftData.versionNumber,
              versionDescription:
                draftData.versionDescription || "Draft snapshot",
              isDraft: true,
              isActive: false,
              published: false,
              createdBy: userSession.userId,
              name: draftData.assignmentData.name || assignment.name,
              introduction:
                draftData.assignmentData.introduction ??
                assignment.introduction,
              instructions:
                draftData.assignmentData.instructions ??
                assignment.instructions,
              gradingCriteriaOverview:
                draftData.assignmentData.gradingCriteriaOverview ??
                assignment.gradingCriteriaOverview,
              timeEstimateMinutes:
                draftData.assignmentData.timeEstimateMinutes ||
                assignment.timeEstimateMinutes,
              type: draftData.assignmentData.type || assignment.type,
              graded: draftData.assignmentData.graded ?? assignment.graded,
              numAttempts:
                draftData.assignmentData.numAttempts ?? assignment.numAttempts,
              attemptsBeforeCoolDown:
                draftData.assignmentData.attemptsBeforeCoolDown ??
                assignment.attemptsBeforeCoolDown,
              retakeAttemptCoolDownMinutes:
                draftData.assignmentData.retakeAttemptCoolDownMinutes ??
                assignment.retakeAttemptCoolDownMinutes,
              allotedTimeMinutes:
                draftData.assignmentData.allotedTimeMinutes ??
                assignment.allotedTimeMinutes,
              attemptsPerTimeRange:
                draftData.assignmentData.attemptsPerTimeRange ??
                assignment.attemptsPerTimeRange,
              attemptsTimeRangeHours:
                draftData.assignmentData.attemptsTimeRangeHours ??
                assignment.attemptsTimeRangeHours,
              passingGrade:
                draftData.assignmentData.passingGrade ??
                assignment.passingGrade,
              displayOrder:
                draftData.assignmentData.displayOrder ??
                assignment.displayOrder,
              questionDisplay:
                draftData.assignmentData.questionDisplay ??
                assignment.questionDisplay,
              numberOfQuestionsPerAttempt:
                draftData.assignmentData.numberOfQuestionsPerAttempt ??
                assignment.numberOfQuestionsPerAttempt,
              questionOrder:
                draftData.assignmentData.questionOrder ??
                assignment.questionOrder ??
                [],
              showAssignmentScore:
                draftData.assignmentData.showAssignmentScore ??
                assignment.showAssignmentScore ??
                true,
              showQuestionScore:
                draftData.assignmentData.showQuestionScore ??
                assignment.showQuestionScore ??
                true,
              showPassFailIndicator:
                draftData.assignmentData.showPassFailIndicator ??
                assignment.showPassFailIndicator ??
                false,
              showSubmissionFeedback:
                draftData.assignmentData.showSubmissionFeedback ??
                assignment.showSubmissionFeedback ??
                true,
              showQuestions:
                draftData.assignmentData.showQuestions ??
                assignment.showQuestions ??
                true,
              correctAnswerVisibility:
                draftData.assignmentData.correctAnswerVisibility ??
                assignment.correctAnswerVisibility,
              requireAllQuestions:
                draftData.assignmentData.requireAllQuestions ??
                assignment.requireAllQuestions,
              optionalQuestionIds:
                draftData.assignmentData.optionalQuestionIds ??
                assignment.optionalQuestionIds,
              languageCode:
                draftData.assignmentData.languageCode ??
                assignment.languageCode,
            },
          });
        } catch (createError) {
          // A concurrent request (auto-save + manual save, double-click, etc.)
          // can pass the existingVersion pre-check above and then race here.
          // The (assignmentId, versionNumber) unique constraint surfaces as
          // P2002; map it to a 409 so the loser does not propagate as 500.
          if (
            createError instanceof Prisma.PrismaClientKnownRequestError &&
            createError.code === "P2002"
          ) {
            throw new ConflictException(
              `Version ${draftData.versionNumber} already exists for this assignment`,
            );
          }
          throw createError;
        }

        if (!assignmentVersion?.id) {
          // Defensive: prevents the QuestionVersion.create loop from running
          // with assignmentVersionId=undefined if the create above ever
          // resolves without a row (transaction abort edge cases).
          throw new Error(
            `assignmentVersion.create returned no id for assignment ${assignmentId}`,
          );
        }

        const questionsData = draftData.questionsData || [];

        for (const [index, questionData] of questionsData.entries()) {
          await tx.questionVersion.create({
            data: {
              assignmentVersionId: assignmentVersion.id,
              questionId: questionData.id || undefined,
              authorComment: questionData.authorComment ?? null,
              totalPoints: questionData.totalPoints || 0,
              type: questionData.type,
              responseType: questionData.responseType,
              question: questionData.question,
              maxWords: questionData.maxWords || undefined,
              scoring: questionData.scoring || undefined,
              choices: questionData.choices || undefined,
              randomizedChoices: questionData.randomizedChoices || undefined,
              answer: questionData.answer || undefined,
              gradingContextQuestionIds:
                questionData.gradingContextQuestionIds || [],
              maxCharacters: questionData.maxCharacters || undefined,
              videoPresentationConfig:
                questionData.videoPresentationConfig || undefined,
              liveRecordingConfig:
                questionData.liveRecordingConfig || undefined,
              displayOrder: index + 1,
            },
          });
        }

        return {
          id: assignmentVersion.id,
          versionNumber: assignmentVersion.versionNumber,
          versionDescription: assignmentVersion.versionDescription,
          isDraft: assignmentVersion.isDraft,
          isActive: assignmentVersion.isActive,
          published: assignmentVersion.published,
          createdBy: assignmentVersion.createdBy,
          createdAt: assignmentVersion.createdAt,
          questionCount: questionsData.length,
        };
      });
    } catch (error) {
      this.logger.error("Failed to save draft snapshot:", error);
      throw error;
    }
  }
}
