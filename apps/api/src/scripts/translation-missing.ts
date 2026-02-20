#!/usr/bin/env ts-node
/* eslint-disable */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { TranslationService } from "../api/assignment/v2/services/translation.service";
import { getAllLanguageCodes } from "../api/assignment/attempt/helper/languages";

type MissingItem = {
  questionId: number;
  variantId: number | null;
  missingLanguages: string[];
  text: string;
  choices: any;
};

type AssignmentScanResult = {
  assignmentId: number;
  assignmentName: string;
  missingAssignmentLanguages: string[];
  missingItems: MissingItem[];
};

const normalizeLang = (code: string) => code.toLowerCase();

function parseListArg(name: string): number[] | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!arg) return undefined;
  const values = arg
    .split("=")[1]
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => !Number.isNaN(v) && v > 0);
  return values.length > 0 ? values : undefined;
}

function parseNumberArg(name: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!arg) return undefined;
  const value = Number.parseInt(arg.split("=")[1], 10);
  return Number.isNaN(value) ? undefined : value;
}

async function scanAssignment(
  prisma: PrismaService,
  assignmentId: number,
  supportedLanguages: string[],
  includeAll: boolean,
): Promise<AssignmentScanResult | null> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      name: true,
      published: true,
      currentVersion: {
        select: {
          isActive: true,
          isDraft: true,
        },
      },
    },
  });

  if (!assignment) {
    console.log(`❌ Assignment ${assignmentId} not found`);
    return null;
  }

  const assignmentTranslations = await prisma.assignmentTranslation.findMany({
    where: { assignmentId },
    select: { languageCode: true },
  });

  const assignmentLangs = new Set(
    assignmentTranslations.map((t) => normalizeLang(t.languageCode)),
  );
  const missingAssignmentLanguages = supportedLanguages.filter(
    (lang) => !assignmentLangs.has(normalizeLang(lang)),
  );

  const questions = await prisma.question.findMany({
    where: {
      assignmentId,
      ...(includeAll ? {} : { isDeleted: false }),
    },
    select: {
      id: true,
      question: true,
      choices: true,
      translations: {
        select: {
          languageCode: true,
          variantId: true,
        },
      },
      variants: {
        where: includeAll ? {} : { isDeleted: false },
        select: {
          id: true,
          variantContent: true,
          choices: true,
        },
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
        text: question.question,
        choices: question.choices,
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
          text: variant.variantContent,
          choices: variant.choices,
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

async function main() {
  const command = process.argv[2];
  const includeAll = process.argv.includes("--include-all");
  const dryRun = process.argv.includes("--dry-run");
  const assignmentIds = parseListArg("--assignments");
  const limit = parseNumberArg("--limit");
  const maxMissing = parseNumberArg("--max-missing");

  if (!command || !["find-missing", "fix-missing"].includes(command)) {
    console.log(`
🔧 Missing Translation Audit Tool

Usage:
  ts-node src/scripts/translation-missing.ts find-missing [--assignments=1,2,3] [--limit=N] [--include-all]
  ts-node src/scripts/translation-missing.ts fix-missing  [--assignments=1,2,3] [--max-missing=N] [--dry-run] [--include-all]

Options:
  --assignments=1,2,3   Only scan these assignment IDs
  --limit=N             Limit number of assignments scanned (find-missing)
  --max-missing=N       Limit number of missing translation entries to fix
  --dry-run             Show what would be fixed without writing
  --include-all         Include inactive/draft/deleted questions and versions
`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const prisma = app.get(PrismaService);
  const translationService = app.get(TranslationService);

  const supportedLanguages = getAllLanguageCodes() ?? ["en"];

  let assignmentsToScan: Array<{ id: number; name?: string }> = [];

  if (assignmentIds && assignmentIds.length > 0) {
    assignmentsToScan = assignmentIds.map((id) => ({ id }));
  } else {
    const assignments = await prisma.assignment.findMany({
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
    assignmentsToScan = assignments;
  }

  if (assignmentsToScan.length === 0) {
    console.log("✅ No assignments found to scan.");
    await app.close();
    return;
  }

  console.log(
    `🔍 Scanning ${assignmentsToScan.length} assignment(s) for missing translations...`,
  );

  const results: AssignmentScanResult[] = [];

  for (const assignment of assignmentsToScan) {
    const scanResult = await scanAssignment(
      prisma,
      assignment.id,
      supportedLanguages,
      includeAll,
    );

    if (!scanResult) continue;

    if (
      scanResult.missingAssignmentLanguages.length > 0 ||
      scanResult.missingItems.length > 0
    ) {
      results.push(scanResult);
    }
  }

  if (command === "find-missing") {
    if (results.length === 0) {
      console.log("✅ No missing translations found.");
      await app.close();
      return;
    }

    console.log(
      `\n📊 Found ${results.length} assignment(s) with missing translations\n`,
    );

    for (const result of results) {
      console.log(
        `- Assignment ${result.assignmentId} "${result.assignmentName}"`,
      );

      if (result.missingAssignmentLanguages.length > 0) {
        console.log(
          `Missing assignment translations: ${result.missingAssignmentLanguages.join(
            ", ",
          )}`,
        );
      }

      if (result.missingItems.length > 0) {
        console.log("Missing question/variant translations:");
        for (const item of result.missingItems) {
          const target =
            item.variantId === null
              ? `Question ${item.questionId}`
              : `Variant ${item.variantId} (Question ${item.questionId})`;
          console.log(`- ${target}: ${item.missingLanguages.join(", ")}`);
        }
      }

      console.log("");
    }

    await app.close();
    return;
  }

  if (results.length === 0) {
    console.log("✅ No missing translations found.");
    await app.close();
    return;
  }

  let processedMissing = 0;

  for (const result of results) {
    console.log(
      `\n🛠️  Fixing missing translations for assignment ${result.assignmentId} "${result.assignmentName}"`,
    );

    if (result.missingAssignmentLanguages.length > 0) {
      console.log(
        `Assignment translations missing: ${result.missingAssignmentLanguages.join(
          ", ",
        )}`,
      );
      if (!dryRun) {
        await translationService.translateAssignment(result.assignmentId);
      } else {
        console.log("Dry-run: would translate assignment metadata");
      }
    }

    for (const item of result.missingItems) {
      if (maxMissing && processedMissing >= maxMissing) {
        console.log(
          `Reached max missing limit (${maxMissing}). Stopping early.`,
        );
        await app.close();
        return;
      }

      if (!item.text || item.text.trim().length === 0) {
        console.log(
          `Skipping empty text for question ${item.questionId} variant ${item.variantId ?? "N/A"}`,
        );
        continue;
      }

      const sourceLanguage = await translationService.detectLanguage(
        item.text,
        result.assignmentId,
      );

      for (const lang of item.missingLanguages) {
        if (maxMissing && processedMissing >= maxMissing) {
          console.log(
            `Reached max missing limit (${maxMissing}). Stopping early.`,
          );
          await app.close();
          return;
        }

        const target =
          item.variantId === null
            ? `Question ${item.questionId}`
            : `Variant ${item.variantId} (Question ${item.questionId})`;

        console.log(`Translating ${target} -> ${lang}`);

        if (!dryRun) {
          await translationService.translateContentToLanguages(
            result.assignmentId,
            item.questionId,
            item.variantId,
            item.text,
            item.choices,
            sourceLanguage,
            [lang],
          );
        } else {
          console.log("Dry-run: would create translation record");
        }

        processedMissing++;
      }
    }
  }

  console.log(`\n✅ Completed. Processed ${processedMissing} missing entries.`);
  await app.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}
