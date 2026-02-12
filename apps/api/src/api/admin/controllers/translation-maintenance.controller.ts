import {
  Body,
  BadRequestException,
  Controller,
  NotFoundException,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { getAllLanguageCodes } from "src/api/assignment/attempt/helper/languages";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VariantDto,
  VariantType,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { TranslationService } from "src/api/assignment/v2/services/translation.service";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { PrismaService } from "src/database/prisma.service";

class MissingTranslationsRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignmentIds?: number[];

  @IsOptional()
  @IsBoolean()
  includeAll?: boolean;

  @IsOptional()
  @IsBoolean()
  includeNames?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

class FixMissingTranslationsRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignmentIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignmentId?: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  languageCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxMissing?: number;
}

type MissingItem = {
  questionId: number;
  variantId: number | null;
  missingLanguages: string[];
  text?: string;
  choices?: any;
};

type AssignmentScanResult = {
  assignmentId: number;
  assignmentName: string;
  missingAssignmentLanguages: string[];
  missingItems: MissingItem[];
};

type MissingAssignmentSummary = {
  assignmentId: number;
  assignmentName: string;
};

const normalizeLang = (code: string) => code.toLowerCase();

@ApiTags("Admin")
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller({
  path: "admin/translations",
  version: "1",
})
export class TranslationMaintenanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
  ) {}

  @Post("missing/find")
  @ApiOperation({ summary: "Find assignments with missing translations" })
  async findMissingTranslations(
    @Body() body: MissingTranslationsRequestDto,
  ): Promise<{
    success: true;
    data: number[] | MissingAssignmentSummary[];
  }> {
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const includeAll = Boolean(body.includeAll);
    const includeNames = Boolean(body.includeNames);

    const assignments = await this.resolveAssignmentsToScan(
      body.assignmentIds,
      includeAll,
      body.limit,
    );

    const results: MissingAssignmentSummary[] = [];
    const assignmentIds: number[] = [];

    for (const assignment of assignments) {
      const scanResult = await this.scanAssignment(
        assignment.id,
        supportedLanguages,
        includeAll,
        false,
      );

      if (!scanResult) continue;

      if (
        scanResult.missingAssignmentLanguages.length > 0 ||
        scanResult.missingItems.length > 0
      ) {
        assignmentIds.push(scanResult.assignmentId);
        if (includeNames) {
          results.push({
            assignmentId: scanResult.assignmentId,
            assignmentName: scanResult.assignmentName,
          });
        }
      }
    }

    return { success: true, data: includeNames ? results : assignmentIds };
  }

  @Post("missing/fix")
  @ApiBody({
    type: FixMissingTranslationsRequestDto,
    examples: {
      default: {
        summary: "Translate latest version questions for assignments",
        value: {
          assignmentIds: [123, 456],
          languageCodes: ["en", "es", "fr"],
          dryRun: false,
          maxMissing: 100,
        },
      },
    },
  })
  @ApiOperation({ summary: "Fix missing translations for assignments" })
  async fixMissingTranslations(
    @Body() body: FixMissingTranslationsRequestDto,
  ): Promise<{
    success: true;
    processedTranslations: number;
    assignmentsProcessed: number;
    results: Array<{
      assignmentId: number;
      processedTranslations: number;
      questionsTranslated: number;
    }>;
    dryRun: boolean;
  }> {
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const supportedLanguagesByNormalized = new Map(
      supportedLanguages.map((lang) => [normalizeLang(lang), lang]),
    );
    const requestedLanguages = (body.languageCodes ?? [])
      .map((lang) => normalizeLang(lang))
      .filter((lang) => supportedLanguagesByNormalized.has(lang))
      .map((lang) => supportedLanguagesByNormalized.get(lang));
    const targetLanguages =
      requestedLanguages.length > 0 ? requestedLanguages : supportedLanguages;
    const translateAllLanguages =
      targetLanguages.length === supportedLanguages.length;
    const dryRun = Boolean(body.dryRun);
    const maxMissing = body.maxMissing;

    const assignmentIds =
      body.assignmentIds && body.assignmentIds.length > 0
        ? body.assignmentIds
        : body.assignmentId
          ? [body.assignmentId]
          : [];

    if (assignmentIds.length === 0) {
      throw new BadRequestException(
        "Provide assignmentId or assignmentIds to run translations",
      );
    }

    const results: Array<{
      assignmentId: number;
      processedTranslations: number;
      questionsTranslated: number;
    }> = [];

    let processedTranslations = 0;
    let remainingTranslations =
      typeof maxMissing === "number" ? maxMissing : null;

    for (const assignmentId of assignmentIds) {
      const {
        processedTranslations: assignmentProcessed,
        questionsTranslated,
        remainingTranslations: nextRemaining,
      } = await this.translateAssignmentQuestions({
        assignmentId,
        supportedLanguages: targetLanguages,
        translateAssignmentLanguages: targetLanguages,
        translateAllLanguages,
        dryRun,
        remainingTranslations,
      });

      processedTranslations += assignmentProcessed;
      remainingTranslations = nextRemaining;

      results.push({
        assignmentId,
        processedTranslations: assignmentProcessed,
        questionsTranslated,
      });

      if (remainingTranslations !== null && remainingTranslations <= 0) {
        break;
      }
    }

    return {
      success: true,
      processedTranslations,
      assignmentsProcessed: results.length,
      results,
      dryRun,
    };
  }

  private async translateAssignmentQuestions({
    assignmentId,
    supportedLanguages,
    translateAssignmentLanguages,
    translateAllLanguages,
    dryRun,
    remainingTranslations,
  }: {
    assignmentId: number;
    supportedLanguages: string[];
    translateAssignmentLanguages: string[];
    translateAllLanguages: boolean;
    dryRun: boolean;
    remainingTranslations: number | null;
  }): Promise<{
    processedTranslations: number;
    questionsTranslated: number;
    remainingTranslations: number | null;
  }> {
    const assignmentWithVersion = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        currentVersion: {
          include: {
            questionVersions: true,
          },
        },
      },
    });

    if (!assignmentWithVersion) {
      throw new NotFoundException(
        `Assignment with id ${assignmentId} not found`,
      );
    }

    if (!dryRun) {
      await (translateAllLanguages
        ? this.translationService.translateAssignment(assignmentId)
        : this.translationService.translateAssignmentForLanguages(
            assignmentId,
            translateAssignmentLanguages,
          ));
    }

    const questionVersions =
      assignmentWithVersion.currentVersion?.questionVersions ?? [];

    let questionsToTranslate: Array<{
      questionId: number;
      questionDto: QuestionDto;
      variants: VariantDto[];
    }> = [];

    if (questionVersions.length > 0) {
      const questionIds = questionVersions
        .map((qv) => qv.questionId)
        .filter((id): id is number => typeof id === "number");

      const originalQuestions =
        questionIds.length > 0
          ? await this.prisma.question.findMany({
              where: { id: { in: questionIds }, isDeleted: false },
              select: {
                id: true,
                variants: {
                  where: { isDeleted: false },
                  select: {
                    id: true,
                    variantContent: true,
                    choices: true,
                    scoring: true,
                    maxWords: true,
                    maxCharacters: true,
                    variantType: true,
                    randomizedChoices: true,
                    isDeleted: true,
                  },
                },
              },
            })
          : [];

      const questionById = new Map(
        originalQuestions.map((question) => [question.id, question]),
      );

      questionsToTranslate = questionVersions
        .filter((qv) => qv.questionId && questionById.has(qv.questionId))
        .map((qv) => {
          const baseQuestion = questionById.get(qv.questionId);
          const variants: VariantDto[] =
            baseQuestion?.variants?.map((variant) => ({
              id: variant.id,
              variantContent: variant.variantContent ?? "",
              choices: variant.choices as unknown as Choice[],
              scoring: variant.scoring as unknown as ScoringDto,
              maxWords: variant.maxWords ?? undefined,
              maxCharacters: variant.maxCharacters ?? undefined,
              variantType: variant.variantType as VariantType,
              isDeleted: variant.isDeleted ?? false,
            })) ?? [];

          const questionDto: QuestionDto = {
            id: qv.questionId,
            assignmentId,
            question: qv.question ?? "",
            type: qv.type,
            responseType: qv.responseType ?? undefined,
            totalPoints: qv.totalPoints,
            maxWords: qv.maxWords ?? undefined,
            maxCharacters: qv.maxCharacters ?? undefined,
            choices: qv.choices as unknown as Choice[],
            scoring: qv.scoring as unknown as ScoringDto,
            answer: qv.answer,
            gradingContextQuestionIds: qv.gradingContextQuestionIds ?? [],
            randomizedChoices: qv.randomizedChoices ?? undefined,
            videoPresentationConfig:
              qv.videoPresentationConfig as unknown as VideoPresentationConfig,
            liveRecordingConfig: qv.liveRecordingConfig as object,
            variants: [],
            isDeleted: false,
          };

          return {
            questionId: qv.questionId,
            questionDto,
            variants,
          };
        });
    } else {
      const questions = await this.prisma.question.findMany({
        where: { assignmentId, isDeleted: false },
        select: {
          id: true,
          question: true,
          type: true,
          assignmentId: true,
          totalPoints: true,
          maxWords: true,
          maxCharacters: true,
          choices: true,
          scoring: true,
          answer: true,
          gradingContextQuestionIds: true,
          responseType: true,
          randomizedChoices: true,
          videoPresentationConfig: true,
          liveRecordingConfig: true,
          isDeleted: true,
          variants: {
            where: { isDeleted: false },
            select: {
              id: true,
              variantContent: true,
              choices: true,
              scoring: true,
              maxWords: true,
              maxCharacters: true,
              variantType: true,
              randomizedChoices: true,
              isDeleted: true,
            },
          },
        },
      });

      questionsToTranslate = questions.map((question) => ({
        questionId: question.id,
        questionDto: {
          id: question.id,
          assignmentId,
          question: question.question ?? "",
          type: question.type,
          responseType: question.responseType ?? undefined,
          totalPoints: question.totalPoints ?? undefined,
          maxWords: question.maxWords ?? undefined,
          maxCharacters: question.maxCharacters ?? undefined,
          choices: question.choices as unknown as Choice[],
          scoring: question.scoring as unknown as ScoringDto,
          answer: question.answer,
          gradingContextQuestionIds: question.gradingContextQuestionIds ?? [],
          randomizedChoices: question.randomizedChoices ?? undefined,
          videoPresentationConfig:
            question.videoPresentationConfig as unknown as VideoPresentationConfig,
          liveRecordingConfig: question.liveRecordingConfig as object,
          variants: [],
          isDeleted: question.isDeleted ?? false,
        },
        variants: question.variants.map((variant) => ({
          id: variant.id,
          variantContent: variant.variantContent ?? "",
          choices: variant.choices as unknown as Choice[],
          scoring: variant.scoring as unknown as ScoringDto,
          maxWords: variant.maxWords ?? undefined,
          maxCharacters: variant.maxCharacters ?? undefined,
          variantType: variant.variantType as VariantType,
          isDeleted: variant.isDeleted ?? false,
        })),
      }));
    }

    let processedTranslations = 0;

    if (remainingTranslations === null) {
      const totalItems = questionsToTranslate.reduce(
        (count, question) => count + 1 + question.variants.length,
        0,
      );

      if (!dryRun) {
        for (const question of questionsToTranslate) {
          await this.translationService.translateQuestion(
            assignmentId,
            question.questionId,
            question.questionDto,
            undefined,
            true,
          );

          for (const variant of question.variants) {
            await this.translationService.translateVariant(
              assignmentId,
              question.questionId,
              variant.id,
              variant,
              undefined,
              true,
            );
          }
        }
      }

      processedTranslations = totalItems * supportedLanguages.length;

      return {
        processedTranslations,
        questionsTranslated: questionsToTranslate.length,
        remainingTranslations,
      };
    }

    const translateItem = async (item: {
      questionId: number;
      variantId: number | null;
      text: string;
      choices?: any;
    }): Promise<boolean> => {
      if (!item.text || item.text.trim().length === 0) {
        return true;
      }

      const remaining =
        remainingTranslations === null
          ? null
          : Math.max(0, remainingTranslations);

      if (remaining !== null && remaining <= 0) {
        return false;
      }

      const languagesToProcess =
        remaining === null
          ? supportedLanguages
          : supportedLanguages.slice(0, remaining);

      if (languagesToProcess.length === 0) {
        return false;
      }

      const sourceLanguage = await this.translationService.detectLanguage(
        item.text,
        assignmentId,
      );

      if (!dryRun) {
        await this.prisma.translation.deleteMany({
          where: {
            questionId: item.questionId,
            variantId: item.variantId,
            languageCode: { in: languagesToProcess },
          },
        });
        await this.translationService.translateContentToLanguages(
          assignmentId,
          item.questionId,
          item.variantId,
          item.text,
          item.choices ?? null,
          sourceLanguage,
          languagesToProcess,
        );
      }

      processedTranslations += languagesToProcess.length;
      if (remainingTranslations !== null) {
        remainingTranslations -= languagesToProcess.length;
      }

      return !(remainingTranslations !== null && remainingTranslations <= 0);
    };

    for (const question of questionsToTranslate) {
      const shouldContinue = await translateItem({
        questionId: question.questionId,
        variantId: null,
        text: question.questionDto.question,
        choices: question.questionDto.choices,
      });

      if (!shouldContinue) {
        break;
      }

      for (const variant of question.variants) {
        const continueVariants = await translateItem({
          questionId: question.questionId,
          variantId: variant.id,
          text: variant.variantContent,
          choices: variant.choices,
        });

        if (!continueVariants) {
          break;
        }
      }

      if (remainingTranslations !== null && remainingTranslations <= 0) {
        break;
      }
    }

    return {
      processedTranslations,
      questionsTranslated: questionsToTranslate.length,
      remainingTranslations,
    };
  }

  private async resolveAssignmentsToScan(
    assignmentIds: number[] | undefined,
    includeAll: boolean,
    limit?: number,
  ): Promise<Array<{ id: number; name: string }>> {
    if (assignmentIds && assignmentIds.length > 0) {
      const assignments = await this.prisma.assignment.findMany({
        where: { id: { in: assignmentIds } },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });
      return assignments;
    }

    return this.prisma.assignment.findMany({
      where: includeAll
        ? {}
        : {
            published: true,
            currentVersion: {
              isActive: true,
              isDraft: false,
            },
          },
      select: { id: true, name: true },
      take: limit,
      orderBy: { id: "asc" },
    });
  }

  private async scanAssignment(
    assignmentId: number,
    supportedLanguages: string[],
    includeAll: boolean,
    includeText: boolean,
  ): Promise<AssignmentScanResult | null> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, name: true },
    });

    if (!assignment) return null;

    const assignmentTranslations =
      await this.prisma.assignmentTranslation.findMany({
        where: { assignmentId },
        select: { languageCode: true },
      });

    const assignmentLangs = new Set(
      assignmentTranslations.map((t) => normalizeLang(t.languageCode)),
    );
    const missingAssignmentLanguages = supportedLanguages.filter(
      (lang) => !assignmentLangs.has(normalizeLang(lang)),
    );

    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        ...(includeAll ? {} : { isDeleted: false }),
      },
      select: {
        id: true,
        question: true,
        choices: true,
        translations: {
          select: { languageCode: true, variantId: true },
        },
        variants: {
          where: includeAll ? {} : { isDeleted: false },
          select: { id: true, variantContent: true, choices: true },
        },
      },
    });

    const missingItems: MissingItem[] = [];

    for (const question of questions) {
      const languageMap = new Map<string, Set<string>>();

      for (const translation of question.translations) {
        const key = translation.variantId
          ? `variant-${translation.variantId}`
          : `question-${question.id}`;
        if (!languageMap.has(key)) {
          languageMap.set(key, new Set<string>());
        }
        languageMap.get(key)?.add(normalizeLang(translation.languageCode));
      }

      const questionKey = `question-${question.id}`;
      const questionLangs = languageMap.get(questionKey) ?? new Set<string>();
      const missingQuestionLangs = supportedLanguages.filter(
        (lang) => !questionLangs.has(normalizeLang(lang)),
      );

      if (missingQuestionLangs.length > 0) {
        missingItems.push({
          questionId: question.id,
          variantId: null,
          missingLanguages: missingQuestionLangs,
          text: includeText ? question.question : undefined,
          choices: includeText ? question.choices : undefined,
        });
      }

      for (const variant of question.variants) {
        const variantKey = `variant-${variant.id}`;
        const variantLangs = languageMap.get(variantKey) ?? new Set<string>();
        const missingVariantLangs = supportedLanguages.filter(
          (lang) => !variantLangs.has(normalizeLang(lang)),
        );

        if (missingVariantLangs.length > 0) {
          missingItems.push({
            questionId: question.id,
            variantId: variant.id,
            missingLanguages: missingVariantLangs,
            text: includeText ? variant.variantContent : undefined,
            choices: includeText ? variant.choices : undefined,
          });
        }
      }
    }

    return {
      assignmentId: assignment.id,
      assignmentName: assignment.name,
      missingAssignmentLanguages,
      missingItems,
    };
  }
}
