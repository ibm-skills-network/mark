import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Question, QuestionVersion } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import IORedis from "ioredis";
import {
  Choice,
  ScoringDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "src/database/prisma.service";
import { createRedisConnection } from "src/job-queue/redis.connection";
import { EnhancedAttemptQuestionDto } from "../common/utils/attempt-questions-mapper.util";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";

const ATTEMPT_ACCESS_CACHE_TTL_SECONDS = 10 * 60;

type QuestionSource = Pick<
  Question,
  | "id"
  | "question"
  | "type"
  | "assignmentId"
  | "totalPoints"
  | "maxWords"
  | "maxCharacters"
  | "choices"
  | "scoring"
  | "answer"
  | "gradingContextQuestionIds"
  | "responseType"
  | "isDeleted"
  | "randomizedChoices"
  | "videoPresentationConfig"
  | "liveRecordingConfig"
>;

@Injectable()
export class AttemptAccessCacheService implements OnModuleDestroy {
  private readonly logger: Logger;
  private redis?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AttemptAccessCacheService.name,
    });
    this.redis = this.createRedisClient();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        // Ignore teardown failures.
      });
    }
  }

  async getQuestionDtosForAttemptAccess(parameters: {
    assignmentId: number;
    assignmentUpdatedAt: Date;
    assignmentVersionId?: number | null;
    questionVersions?: QuestionVersion[];
  }): Promise<EnhancedAttemptQuestionDto[]> {
    const cacheKey = this.buildCacheKey(parameters);
    const cached = await this.redisGet(cacheKey);
    if (cached) {
      return cached;
    }

    const built = parameters.assignmentVersionId
      ? this.buildFromQuestionVersions(
          parameters.questionVersions ?? [],
          parameters.assignmentId,
        )
      : this.buildFromQuestions(
          await this.prisma.question.findMany({
            where: {
              assignmentId: parameters.assignmentId,
              isDeleted: false,
            },
          }),
        );

    await this.redisSet(cacheKey, built);
    return built;
  }

  async invalidateForAssignment(assignmentId: number): Promise<void> {
    if (!this.redis) {
      this.logger.debug(
        `attempt-access-cache.invalidate.skip { assignmentId: ${assignmentId}, reason: "no-redis" }`,
      );
      return;
    }

    let assignmentKeysDeleted = 0;
    let versionKeysDeleted = 0;

    try {
      const matchPattern = `mark:attempt-access:assignment:${assignmentId}:*`;
      let cursor = "0";
      do {
        const [nextCursor, batch] = await this.redis.scan(
          cursor,
          "MATCH",
          matchPattern,
          "COUNT",
          100,
        );
        if (batch.length > 0) {
          assignmentKeysDeleted += await this.redis.del(...batch);
        }
        cursor = nextCursor;
      } while (cursor !== "0");

      const versions = await this.prisma.assignmentVersion.findMany({
        where: { assignmentId },
        select: { id: true },
      });
      if (versions.length > 0) {
        const versionKeys = versions.map(
          (v) => `mark:attempt-access:version:${v.id}`,
        );
        versionKeysDeleted = await this.redis.del(...versionKeys);
      }

      this.logger.info(
        `attempt-access-cache.invalidate.done { assignmentId: ${assignmentId}, assignmentKeysDeleted: ${assignmentKeysDeleted}, versionKeysDeleted: ${versionKeysDeleted} }`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `attempt-access-cache.invalidate.failed { assignmentId: ${assignmentId}, error: ${JSON.stringify(message)} }`,
      );
    }
  }

  private createRedisClient(): IORedis | undefined {
    try {
      const client = createRedisConnection();
      client.on("error", (error) => {
        this.logger.warn(
          `AttemptAccessCache Redis error (falling back to PostgreSQL): ${error.message}`,
        );
      });
      return client;
    } catch {
      this.logger.warn(
        "AttemptAccessCache could not connect to Redis — running without cache",
      );
      return undefined;
    }
  }

  private buildCacheKey(parameters: {
    assignmentId: number;
    assignmentUpdatedAt: Date;
    assignmentVersionId?: number | null;
  }): string {
    if (parameters.assignmentVersionId) {
      return `mark:attempt-access:version:${parameters.assignmentVersionId}`;
    }

    return `mark:attempt-access:assignment:${parameters.assignmentId}:${parameters.assignmentUpdatedAt.getTime()}`;
  }

  private async redisGet(
    cacheKey: string,
  ): Promise<EnhancedAttemptQuestionDto[] | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as EnhancedAttemptQuestionDto[];
    } catch {
      return null;
    }
  }

  private async redisSet(
    cacheKey: string,
    value: EnhancedAttemptQuestionDto[],
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(value),
        "EX",
        ATTEMPT_ACCESS_CACHE_TTL_SECONDS,
      );
    } catch {
      // Cache failures are non-fatal.
    }
  }

  private buildFromQuestionVersions(
    questionVersions: QuestionVersion[],
    assignmentId: number,
  ): EnhancedAttemptQuestionDto[] {
    return questionVersions.map((qv) =>
      this.toEnhancedAttemptQuestionDto(
        {
          id: qv.questionId || qv.id,
          question: qv.question,
          type: qv.type,
          assignmentId,
          totalPoints: qv.totalPoints,
          maxWords: qv.maxWords,
          maxCharacters: qv.maxCharacters,
          choices: qv.choices,
          scoring: qv.scoring,
          answer: qv.answer,
          gradingContextQuestionIds: qv.gradingContextQuestionIds,
          responseType: qv.responseType,
          isDeleted: false,
          randomizedChoices: qv.randomizedChoices,
          videoPresentationConfig: qv.videoPresentationConfig,
          liveRecordingConfig: qv.liveRecordingConfig,
        },
        assignmentId,
      ),
    );
  }

  private buildFromQuestions(
    questions: QuestionSource[],
  ): EnhancedAttemptQuestionDto[] {
    return questions.map((question) =>
      this.toEnhancedAttemptQuestionDto(question, question.assignmentId),
    );
  }

  private toEnhancedAttemptQuestionDto(
    question: QuestionSource,
    assignmentId: number,
  ): EnhancedAttemptQuestionDto {
    const answerValue =
      typeof question.answer === "boolean"
        ? String(question.answer)
        : question.answer !== null && question.answer !== undefined
          ? String(question.answer)
          : undefined;

    const randomizedChoicesValue =
      typeof question.randomizedChoices === "string"
        ? question.randomizedChoices
        : JSON.stringify(question.randomizedChoices ?? false);

    return {
      id: question.id,
      question: question.question,
      type: question.type,
      assignmentId,
      totalPoints: question.totalPoints,
      maxWords: question.maxWords || undefined,
      maxCharacters: question.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(question.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(question.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer: answerValue,
      gradingContextQuestionIds: question.gradingContextQuestionIds || [],
      responseType: question.responseType || undefined,
      isDeleted: question.isDeleted,
      randomizedChoices: randomizedChoicesValue,
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          question.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        question.liveRecordingConfig,
        null,
      ),
    };
  }

  private parseJsonValue<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }

    return value as T;
  }
}
