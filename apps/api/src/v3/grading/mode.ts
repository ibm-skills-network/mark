import { Inject, Injectable } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import {
  type GradingEffort,
  gradingEffortSchema,
  type GradingLogger,
} from "./contracts";

export const GRADING_MODES = ["off", "shadow", "live"] as const;
export const gradingModeSchema = z.enum(GRADING_MODES);
export type GradingMode = z.infer<typeof gradingModeSchema>;

/** Question types the v3 grader handles today. */
export const V3_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  QuestionType.TEXT,
  QuestionType.UPLOAD,
  QuestionType.LINK_FILE,
  QuestionType.URL,
]);

/** Starting efforts per type; a config row's effort overrides them. */
export const DEFAULT_EFFORT: Partial<Record<QuestionType, GradingEffort>> = {
  [QuestionType.TEXT]: "low",
  [QuestionType.UPLOAD]: "medium",
  [QuestionType.LINK_FILE]: "medium",
  [QuestionType.URL]: "medium",
};

export interface ModeConfigRow {
  id: number;
  questionType: QuestionType;
  assignmentId: number | null;
  mode: string;
  effort: string | null;
}

export interface ResolvedMode {
  mode: GradingMode;
  effort: GradingEffort;
  source: "assignment" | "global" | "default" | "error";
  configId?: number;
}

export interface ModeResolverDeps {
  /** The assignment row and the global row for this type, if they exist. */
  readRows(
    questionType: QuestionType,
    assignmentId: number | null,
  ): Promise<ModeConfigRow[]>;
  logger: GradingLogger;
  now?: () => number;
  /** Read per call so tests can flip it; defaults to process.env. */
  shadowAllowed?: () => boolean;
  ttlMs?: number;
}

export const MODE_CACHE_TTL_MS = 30_000;

function defaultEffort(questionType: QuestionType): GradingEffort {
  return DEFAULT_EFFORT[questionType] ?? "medium";
}

/** Config rows → mode, before the shadow guard. Unknown values read as off. */
export function pickMode(
  questionType: QuestionType,
  assignmentId: number | null,
  rows: ModeConfigRow[],
): ResolvedMode {
  const assignmentRow =
    assignmentId === null
      ? undefined
      : rows.find((row) => row.assignmentId === assignmentId);
  const globalRow = rows.find((row) => row.assignmentId === null);
  const row = assignmentRow ?? globalRow;
  if (!row) {
    return {
      mode: "off",
      effort: defaultEffort(questionType),
      source: "default",
    };
  }
  const mode = gradingModeSchema.safeParse(row.mode);
  const effort = gradingEffortSchema.safeParse(row.effort);
  return {
    mode: mode.success ? mode.data : "off",
    effort: effort.success ? effort.data : defaultEffort(questionType),
    source: assignmentRow ? "assignment" : "global",
    configId: row.id,
  };
}

export class GradingModeResolver {
  private readonly cache = new Map<
    string,
    { expiresAt: number; resolved: ResolvedMode }
  >();

  constructor(private readonly deps: ModeResolverDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private shadowAllowed(): boolean {
    return this.deps.shadowAllowed
      ? this.deps.shadowAllowed()
      : process.env.GRADING_SHADOW_ALLOWED === "true";
  }

  clear(): void {
    this.cache.clear();
  }

  async resolve(
    questionType: QuestionType,
    assignmentId: number | null,
  ): Promise<ResolvedMode> {
    if (!V3_QUESTION_TYPES.has(questionType)) {
      return {
        mode: "off",
        effort: defaultEffort(questionType),
        source: "default",
      };
    }
    const key = `${questionType}:${assignmentId ?? "global"}`;
    const cached = this.cache.get(key);
    let resolved: ResolvedMode;
    if (cached && cached.expiresAt > this.now()) {
      resolved = cached.resolved;
    } else {
      try {
        const rows = await this.deps.readRows(questionType, assignmentId);
        resolved = pickMode(questionType, assignmentId, rows);
        this.cache.set(key, {
          expiresAt: this.now() + (this.deps.ttlMs ?? MODE_CACHE_TTL_MS),
          resolved,
        });
      } catch (error) {
        // Not cached: the next question reads again. Off means legacy grades.
        this.deps.logger.warn("grading.mode.read_failed", {
          questionType,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          mode: "off",
          effort: defaultEffort(questionType),
          source: "error",
        };
      }
    }
    if (resolved.mode === "shadow" && !this.shadowAllowed()) {
      this.deps.logger.info("grading.mode.shadow_refused", {
        questionType,
        assignmentId,
        configId: resolved.configId,
      });
      return { ...resolved, mode: "off" };
    }
    return resolved;
  }
}

@Injectable()
export class GradingModeService {
  private readonly logger: Logger;
  readonly resolver: GradingModeResolver;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingModeService.name });
    this.resolver = new GradingModeResolver({
      logger: this.logger,
      readRows: (questionType, assignmentId) =>
        this.prisma.gradingModeConfig.findMany({
          where: {
            questionType,
            OR:
              assignmentId === null
                ? [{ assignmentId: null }]
                : [{ assignmentId: null }, { assignmentId }],
          },
          select: {
            id: true,
            questionType: true,
            assignmentId: true,
            mode: true,
            effort: true,
          },
        }),
    });
  }

  resolve(
    questionType: QuestionType,
    assignmentId: number | null,
  ): Promise<ResolvedMode> {
    return this.resolver.resolve(questionType, assignmentId);
  }

  /** After a PUT, so this worker sees the change at once. */
  invalidate(): void {
    this.resolver.clear();
  }
}
