#!/usr/bin/env ts-node
/* eslint-disable */
import * as fs from "node:fs";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { PrismaClient } from "@prisma/client";
import * as cld from "cld";
import { OpenAiLlmMiniService } from "src/api/llm/core/services/openai-llm-mini.service";
import { createLogger } from "winston";
import { PromptProcessorService } from "../api/llm/core/services/prompt-processor.service";
import { TokenCounterService } from "../api/llm/core/services/token-counter.service";
import { TranslationService } from "../api/llm/features/translation/services/translation.service";
import { markForRetranslationBatch } from "./translation-audit-batch";

const prisma = new PrismaClient();

// Initialize the project's translation service
const logger = createLogger({
  level: "error",
  silent: true, // Keep quiet for CLI usage
});

const promptProcessor = new PromptProcessorService(
  {} as any, // We don't need the LLM router for language detection
  {} as any, // We don't need usage tracker for language detection
  logger,
);

const tokenCounter = new TokenCounterService(logger);
const gpt4MiniService = new OpenAiLlmMiniService(tokenCounter, logger);

// eslint-disable-next-line unicorn/prefer-module
const LANGUAGES_FILE_PATH = path.join(
  __dirname,
  "../api/assignment/attempt/helper/languages.json",
);

const supportedLanguages: Array<{ code: string; name: string }> = JSON.parse(
  fs.readFileSync(LANGUAGES_FILE_PATH, "utf8"),
);
const SUPPORTED_LANGUAGE_CODES = supportedLanguages.map((lang) =>
  lang.code.toLowerCase(),
);

console.log(
  `📋 Loaded ${
    SUPPORTED_LANGUAGE_CODES.length
  } supported languages: ${SUPPORTED_LANGUAGE_CODES.join(", ")}`,
);

interface BadTranslation {
  id: number;
  questionId: number | null;
  variantId: number | null;
  languageCode: string;
  detectedLanguage: string;
  translatedText: string;
  translatedChoices: any;
  issue: string;
}

/**
 * Filter detected language to only return supported languages
 */
function filterToSupportedLanguage(detectedLang: string): string {
  if (!detectedLang || detectedLang === "unknown") {
    return "unknown";
  }

  const normalizedDetected = normalizeLanguageCode(detectedLang);

  // Always allow English detection (even if not in supported list)
  // This is important for detecting untranslated content
  if (normalizedDetected === "en") {
    return "en";
  }

  // Check if detected language is in our supported list
  const isSupported = SUPPORTED_LANGUAGE_CODES.some(
    (supportedCode) =>
      normalizeLanguageCode(supportedCode) === normalizedDetected,
  );

  return isSupported ? normalizedDetected : "unknown";
}

/**
 * Check if two languages are similar enough to be considered equivalent for choice text
 */
function areSimilarLanguages(detected: string, expected: string): boolean {
  const similar = {
    // Romance language confusion groups
    fr: ["it", "es", "pt"],
    it: ["fr", "es", "pt"],
    es: ["pt", "fr", "it"],
    pt: ["es", "fr", "it"],

    // Chinese variants
    "zh-cn": ["zh-tw", "zh"],
    "zh-tw": ["zh-cn", "zh"],
    zh: ["zh-cn", "zh-tw"],

    // English variants
    en: ["en-us", "en-gb", "en-ca"],
  };

  const normalizedDetected = normalizeLanguageCode(detected);
  const normalizedExpected = normalizeLanguageCode(expected);

  if (normalizedDetected === normalizedExpected) {
    return true;
  }

  return similar[normalizedExpected]?.includes(normalizedDetected) || false;
}

/**
 * Use the project's translation service for language detection
 * This provides the same enhanced multi-engine detection with caching
 */
async function detectLanguageRobust(text: string): Promise<{
  detected: string;
  confidence: number;
  engines: { cld?: string; openai?: string; patterns?: string };
  consensus: boolean;
  rawDetections: { cld?: string; openai?: string; patterns?: string };
  cldConfidence?: number;
}> {
  if (!text || text.trim().length === 0) {
    return {
      detected: "unknown",
      confidence: 0,
      engines: {},
      consensus: false,
      rawDetections: {},
    };
  }

  const rawDetections: { cld?: string; openai?: string; patterns?: string } =
    {};
  const engines: { cld?: string; openai?: string; patterns?: string } = {};

  // Try CLD detection first
  let cldLang = "unknown";
  let cldConfidence = 0;
  try {
    const cldResponse = await cld.detect(text);
    cldLang = cldResponse.languages[0].code;
    cldConfidence = cldResponse.languages[0].percent / 100;
    rawDetections.cld = `${cldLang} (${Math.round(cldConfidence * 100)}%)`;
    engines.cld = filterToSupportedLanguage(cldLang);
  } catch {
    rawDetections.cld = "error";
    engines.cld = "error";
  }

  // Use GPT-5-nano for more accurate language detection
  let openaiLang = "unknown";
  let openaiConfidence = 0;
  try {
    const promptContent = `Detect the language of the following text and respond with ONLY the ISO 639-1 language code (e.g., 'en' for English, 'fr' for French, 'es' for Spanish, 'it' for Italian, 'zh-CN' for Simplified Chinese, 'zh-TW' for Traditional Chinese, etc.). 

If the text contains mixed languages, identify the primary language. If you cannot determine the language with confidence, respond with 'unknown'.

Text: "${text}"

Language code:`;

    const response = await gpt4MiniService.invoke([
      new HumanMessage(promptContent),
    ]);

    const detectedCode = response.content?.trim().toLowerCase() || "unknown";

    // Validate the response is a valid language code
    if (
      detectedCode &&
      detectedCode !== "unknown" &&
      detectedCode.match(/^[a-z]{2}(-[a-z]{2,4})?$/i)
    ) {
      openaiLang = detectedCode;
      openaiConfidence = 0.9; // High confidence for LLM detection
      rawDetections.openai = `${openaiLang} (90%)`;
      engines.openai = filterToSupportedLanguage(openaiLang);
    } else {
      rawDetections.openai = "unknown";
      engines.openai = "unknown";
    }
  } catch (error) {
    console.error("Error using GPT-5-nano for language detection:", error);
    rawDetections.openai = "error";
    engines.openai = "error";
  }

  // Determine final detected language
  let detected = "unknown";
  let confidence = 0;
  let consensus = false;

  // Prefer OpenAI detection if available and confident
  if (openaiLang !== "unknown" && openaiConfidence > 0) {
    detected = filterToSupportedLanguage(openaiLang);
    confidence = openaiConfidence;
    // Check consensus between CLD and OpenAI
    consensus =
      normalizeLanguageCode(cldLang) === normalizeLanguageCode(openaiLang);
  } else if (cldLang !== "unknown" && cldConfidence > 0.5) {
    // Fall back to CLD if OpenAI failed
    detected = filterToSupportedLanguage(cldLang);
    confidence = cldConfidence;
    consensus = false;
  }

  return {
    detected,
    confidence,
    engines,
    consensus,
    rawDetections,
    cldConfidence,
  };
}

/**
 * Normalize language codes for comparison
 */
function normalizeLanguageCode(languageCode: string): string {
  const code = languageCode.toLowerCase();

  // Handle Chinese variants
  if (code === "zh-cn" || code === "zh-hans") return "zh-cn";
  if (code === "zh-tw" || code === "zh-hant") return "zh-tw";
  if (code === "zh") return "zh-cn"; // Default Chinese to simplified

  // Handle other common variants
  if (code.startsWith("en-")) return "en";
  if (code.startsWith("es-")) return "es";
  if (code.startsWith("fr-")) return "fr";
  if (code.startsWith("de-")) return "de";
  if (code.startsWith("pt-")) return "pt";

  // Return base language code
  return code.split("-")[0];
}

/**
 * Check if text in translatedChoices has language mismatches with improved accuracy
 */
async function checkChoicesLanguage(
  translatedChoices: any,
  expectedLanguage: string,
): Promise<{ hasIssue: boolean; details: string; debugInfo?: string[] }> {
  if (!translatedChoices) {
    return { hasIssue: false, details: "No choices to check" };
  }

  let choices: any[] = [];

  // Handle different JSON structures
  if (Array.isArray(translatedChoices)) {
    choices = translatedChoices;
  } else if (typeof translatedChoices === "object") {
    // Could be a JSON object with choices array
    choices =
      translatedChoices.choices || translatedChoices.translatedChoices || [];
  }

  if (choices.length === 0) {
    return { hasIssue: false, details: "No choices found in JSON" };
  }

  const issues: string[] = [];
  const debugInfo: string[] = [];

  // Process all choices in parallel
  const choiceResults = await Promise.all(
    choices.map(async (choice, index) => {
      const results: {
        choiceText?: { detection: any; issue?: string };
        feedback?: { detection: any; issue?: string };
      } = {};

      // Check choice text and feedback in parallel
      const [choiceTextDetection, feedbackDetection] = await Promise.all([
        choice.choice
          ? detectLanguageRobust(choice.choice)
          : Promise.resolve(null),
        choice.feedback
          ? detectLanguageRobust(choice.feedback)
          : Promise.resolve(null),
      ]);

      // Process choice text detection
      if (choiceTextDetection && choice.choice) {
        results.choiceText = { detection: choiceTextDetection };

        if (
          choiceTextDetection.detected !== "unknown" &&
          choiceTextDetection.confidence > 0.5 &&
          !areSimilarLanguages(choiceTextDetection.detected, expectedLanguage)
        ) {
          results.choiceText.issue = `Choice ${
            index + 1
          } text: expected ${expectedLanguage}, detected ${
            choiceTextDetection.detected
          } (${Math.round(choiceTextDetection.confidence * 100)}% confidence)`;
        }
      }

      // Process feedback detection
      if (feedbackDetection && choice.feedback) {
        results.feedback = { detection: feedbackDetection };

        if (
          feedbackDetection.detected !== "unknown" &&
          feedbackDetection.confidence > 0.6 &&
          !areSimilarLanguages(feedbackDetection.detected, expectedLanguage)
        ) {
          results.feedback.issue = `Choice ${
            index + 1
          } feedback: expected ${expectedLanguage}, detected ${
            feedbackDetection.detected
          } (${Math.round(feedbackDetection.confidence * 100)}% confidence)`;
        }
      }

      return { index, choice, results };
    }),
  );

  // Collect results
  for (const { index, choice, results } of choiceResults) {
    // Add debug info
    if (results.choiceText) {
      debugInfo.push(
        `Choice ${index + 1} text: "${choice.choice}" -> ${JSON.stringify(
          results.choiceText.detection.rawDetections,
        )} (confidence: ${results.choiceText.detection.confidence.toFixed(2)})`,
      );

      if (results.choiceText.issue) {
        issues.push(results.choiceText.issue);
      }
    }

    if (results.feedback) {
      debugInfo.push(
        `Choice ${index + 1} feedback: "${choice.feedback}" -> ${JSON.stringify(
          results.feedback.detection.rawDetections,
        )} (confidence: ${results.feedback.detection.confidence.toFixed(2)})`,
      );

      if (results.feedback.issue) {
        issues.push(results.feedback.issue);
      }
    }
  }

  return {
    hasIssue: issues.length > 0,
    details:
      issues.length > 0
        ? issues.join("; ")
        : "All choices match expected language",
    debugInfo,
  };
}

/**
 * Find all translation records with language mismatches
 */
async function findBadTranslations(
  isDebugMode = false,
  limit?: number,
  assignmentIds?: number[],
  includeAll = false,
): Promise<BadTranslation[]> {
  console.log("🔍 Scanning translation table for language mismatches...\n");

  const queryOptions: any = {
    orderBy: { id: "asc" },
  };

  // Add assignment ID filtering if specified
  if (assignmentIds && assignmentIds.length > 0) {
    // First, get the question IDs and variant IDs for the specified assignments
    const questionQuery: any = {
      where: {
        assignmentId: {
          in: assignmentIds,
        },
      },
      select: {
        id: true,
        variants: {
          select: {
            id: true,
          },
        },
      },
    };

    // Add active filtering unless includeAll flag is set
    if (!includeAll) {
      questionQuery.where.isDeleted = false;
      // Need to include the assignment relation to check currentVersion
      questionQuery.include = {
        assignment: {
          include: {
            currentVersion: true,
          },
        },
        variants: {
          where: {
            isDeleted: false,
          },
        },
      };
      // Remove the select since we're using include now
      delete questionQuery.select;
    }

    let questions = await prisma.question.findMany(questionQuery);

    // Filter for active questions in active versions if not includeAll
    if (!includeAll) {
      questions = questions.filter(
        (q: any) =>
          q.assignment?.currentVersion?.isActive === true &&
          q.assignment?.currentVersion?.isDraft === false,
      );
    }

    const questionIds = questions.map((q: any) => q.id);
    const variantIds = questions.flatMap((q: any) =>
      q.variants.map((v: any) => v.id),
    );

    const statusText = includeAll ? "all" : "active";
    console.log(
      `📋 Found ${questionIds.length} ${statusText} questions and ${
        variantIds.length
      } ${statusText} variants for assignment IDs: ${assignmentIds.join(", ")}`,
    );

    // Now filter translations based on these IDs
    queryOptions.where = {
      OR: [
        {
          questionId: {
            in: questionIds,
          },
        },
        {
          variantId: {
            in: variantIds,
          },
        },
      ],
    };

    // Use select for performance
    queryOptions.select = {
      id: true,
      questionId: true,
      variantId: true,
      languageCode: true,
      translatedText: true,
      translatedChoices: true,
    };
  } else {
    // When not filtering by assignment, optionally filter globally for active questions and versions
    if (!includeAll) {
      queryOptions.where = {
        OR: [
          {
            // Translations for questions - only active questions from active versions
            questionId: {
              not: null,
            },
            question: {
              isDeleted: false,
              assignment: {
                currentVersion: {
                  isActive: true,
                  isDraft: false,
                },
              },
            },
          },
          {
            // Translations for variants - only active variants of active questions from active versions
            variantId: {
              not: null,
            },
            variant: {
              isDeleted: false,
              variantOf: {
                isDeleted: false,
                assignment: {
                  currentVersion: {
                    isActive: true,
                    isDraft: false,
                  },
                },
              },
            },
          },
        ],
      };

      console.log(
        "📋 Filtering globally for active questions and variants in published assignment versions",
      );
    } else {
      console.log(
        "📋 Including ALL questions and variants (active, deleted, draft versions) - no filtering applied",
      );
    }

    // Use select for better performance
    queryOptions.select = {
      id: true,
      questionId: true,
      variantId: true,
      languageCode: true,
      translatedText: true,
      translatedChoices: true,
    };
  }

  // Add limit if specified
  if (limit && limit > 0) {
    queryOptions.take = limit;
    console.log(`📋 Limiting scan to first ${limit} translation records`);
  }

  const translations = await prisma.translation.findMany(queryOptions);

  console.log(`📊 Found ${translations.length} translation records to check\n`);

  const badTranslations: BadTranslation[] = [];
  const BATCH_SIZE = 10; // Process 10 translations at a time

  // Process translations in batches
  for (let i = 0; i < translations.length; i += BATCH_SIZE) {
    const batch = translations.slice(
      i,
      Math.min(i + BATCH_SIZE, translations.length),
    );
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(translations.length / BATCH_SIZE);

    console.log(
      `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`,
    );

    // Process all translations in this batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (translation) => {
        const issues: string[] = [];
        const debugInfo: string[] = [];

        // Check main text and choices in parallel
        const [mainTextResult, choicesResult] = await Promise.all([
          // Check main translated text
          translation.translatedText
            ? detectLanguageRobust(translation.translatedText)
            : Promise.resolve(null),
          // Check translated choices
          translation.translatedChoices
            ? checkChoicesLanguage(
                translation.translatedChoices,
                translation.languageCode,
              )
            : Promise.resolve(null),
        ]);

        // Process main text detection result
        if (mainTextResult && translation.translatedText) {
          if (isDebugMode) {
            debugInfo.push(
              `Main text: "${translation.translatedText.slice(
                0,
                100,
              )}..." -> ${JSON.stringify(
                mainTextResult.rawDetections,
              )} (confidence: ${mainTextResult.confidence.toFixed(2)})`,
            );
          }

          if (
            mainTextResult.detected !== "unknown" &&
            mainTextResult.confidence > 0.5 &&
            !areSimilarLanguages(
              mainTextResult.detected,
              translation.languageCode,
            )
          ) {
            issues.push(
              `Main text: expected ${translation.languageCode}, detected ${
                mainTextResult.detected
              } (${Math.round(mainTextResult.confidence * 100)}% confidence)`,
            );
          }
        }

        // Process choices detection result
        if (choicesResult) {
          if (choicesResult.hasIssue) {
            issues.push(`Choices: ${choicesResult.details}`);
          }

          if (isDebugMode && (issues.length > 0 || choicesResult.debugInfo)) {
            debugInfo.push(...(choicesResult.debugInfo || []));
          }
        }

        // Return result for this translation
        if (issues.length > 0) {
          return {
            id: translation.id,
            questionId: translation.questionId,
            variantId: translation.variantId,
            languageCode: translation.languageCode,
            detectedLanguage: mainTextResult?.detected || "unknown",
            translatedText: translation.translatedText,
            translatedChoices: translation.translatedChoices,
            issue: issues.join(" | "),
            debugInfo: isDebugMode ? debugInfo : undefined,
          };
        }

        // Return debug info even if no issues found (for debug mode)
        if (isDebugMode && debugInfo.length > 0) {
          return {
            id: translation.id,
            languageCode: translation.languageCode,
            debugInfo,
            hasNoIssues: true,
          };
        }

        return null;
      }),
    );

    // Process batch results
    for (const result of batchResults) {
      if (result && !result.hasNoIssues) {
        badTranslations.push(result as BadTranslation);
      }

      // Show debug info if available
      if (isDebugMode && result?.debugInfo && result.debugInfo.length > 0) {
        console.log(`\n🐛 DEBUG Record ${result.id}:`);
        console.log(`   Expected: ${result.languageCode}`);
        console.log(
          `   Issues: ${
            result.hasNoIssues ? "None" : (result as BadTranslation).issue
          }`,
        );
        for (const info of result.debugInfo) console.log(`   ${info}`);
      }
    }

    // Small delay between batches to avoid overwhelming the API
    if (i + BATCH_SIZE < translations.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return badTranslations;
}

/**
 * Delete translation records only (without retranslating)
 */
async function deleteTranslationsOnly(
  translationIds: number[],
  includeAll = false,
): Promise<void> {
  console.log(`🗑️  Deleting ${translationIds.length} translation records...\n`);

  const deletedRecords: Array<{
    id: number;
    questionId?: number;
    variantId?: number;
    languageCode: string;
  }> = [];

  for (const translationId of translationIds) {
    try {
      // Get the translation record before deletion for logging, including active status checks
      const translation = await prisma.translation.findUnique({
        where: { id: translationId },
        include: {
          question: {
            include: {
              assignment: {
                include: {
                  currentVersion: true,
                },
              },
            },
          },
          variant: {
            include: {
              variantOf: {
                include: {
                  assignment: {
                    include: {
                      currentVersion: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!translation) {
        console.log(`❌ Translation record ${translationId} not found`);
        continue;
      }

      // Check if the translation is for an active question/variant (unless includeAll flag is set)
      if (!includeAll) {
        let isActive = false;
        if (translation.question) {
          isActive =
            !translation.question.isDeleted &&
            translation.question.assignment?.currentVersion?.isActive ===
              true &&
            translation.question.assignment?.currentVersion?.isDraft === false;
        } else if (translation.variant) {
          isActive =
            !translation.variant.isDeleted &&
            !translation.variant.variantOf.isDeleted &&
            translation.variant.variantOf.assignment?.currentVersion
              ?.isActive === true &&
            translation.variant.variantOf.assignment?.currentVersion
              ?.isDraft === false;
        }

        if (!isActive) {
          console.log(
            `⚠️  Skipping deletion of translation ${translationId} - associated question/variant is not active or in an inactive assignment version`,
          );
          continue;
        }
      }

      // Delete the record
      await prisma.translation.delete({
        where: { id: translationId },
      });

      deletedRecords.push({
        id: translation.id,
        questionId: translation.questionId || undefined,
        variantId: translation.variantId || undefined,
        languageCode: translation.languageCode,
      });

      console.log(
        `✅ Deleted translation record ${translationId} (${translation.languageCode})`,
      );
    } catch (error) {
      console.log(`❌ Error deleting record ${translationId}:`, error);
    }
  }

  if (deletedRecords.length > 0) {
    console.log(
      `\n🔄 Deleted ${deletedRecords.length} translation records. These will be regenerated automatically when:`,
    );
    console.log(
      `   1. A learner requests the assignment in the target language`,
    );
    console.log(`   2. You manually trigger translation via the API`);
    console.log(`   3. Assignment translation job is run`);

    console.log(`\n📋 Deleted records summary:`);
    for (const record of deletedRecords) {
      if (record.questionId) {
        console.log(
          `   Question ${record.questionId} -> ${record.languageCode} (Translation ID: ${record.id})`,
        );
      } else if (record.variantId) {
        console.log(
          `   Variant ${record.variantId} -> ${record.languageCode} (Translation ID: ${record.id})`,
        );
      }
    }
  } else {
    console.log(`\n📋 No records were deleted.`);
  }
}

/**
 * Delete all translation records for a specific assignment
 */
async function deleteAssignmentTranslations(
  assignmentId: number,
  includeAll = false,
): Promise<void> {
  console.log(
    `🗑️  Deleting ALL translation records for assignment ${assignmentId}...\n`,
  );

  try {
    // Get all questions and variants for this assignment
    const questionQuery: any = {
      where: {
        assignmentId: assignmentId,
      },
      select: {
        id: true,
        question: true,
        variants: {
          select: {
            id: true,
            variantContent: true,
          },
        },
      },
    };

    // Add active filtering unless includeAll flag is set
    if (!includeAll) {
      questionQuery.where.isDeleted = false;
      questionQuery.include = {
        assignment: {
          include: {
            currentVersion: true,
          },
        },
        variants: {
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
            variantContent: true,
          },
        },
      };
      delete questionQuery.select;
    }

    const questions = await prisma.question.findMany(questionQuery);

    // Filter for active questions in active versions if not includeAll
    const validQuestions = includeAll
      ? questions
      : questions.filter(
          (q: any) =>
            q.assignment?.currentVersion?.isActive === true &&
            q.assignment?.currentVersion?.isDraft === false,
        );

    const questionIds = validQuestions.map((q: any) => q.id);
    const variantIds = validQuestions.flatMap((q: any) =>
      q.variants.map((v: any) => v.id),
    );

    console.log(
      `📋 Found ${questionIds.length} questions and ${variantIds.length} variants for assignment ${assignmentId}`,
    );

    // Step 1: Delete translation records for questions
    let deletedQuestionTranslations = 0;
    if (questionIds.length > 0) {
      const questionTranslationResult = await prisma.translation.deleteMany({
        where: {
          questionId: {
            in: questionIds,
          },
        },
      });
      deletedQuestionTranslations = questionTranslationResult.count;
      console.log(
        `✅ Deleted ${deletedQuestionTranslations} question translation records`,
      );
    }

    // Step 2: Delete translation records for variants
    let deletedVariantTranslations = 0;
    if (variantIds.length > 0) {
      const variantTranslationResult = await prisma.translation.deleteMany({
        where: {
          variantId: {
            in: variantIds,
          },
        },
      });
      deletedVariantTranslations = variantTranslationResult.count;
      console.log(
        `✅ Deleted ${deletedVariantTranslations} variant translation records`,
      );
    }

    // Step 3: Delete assignmentTranslation records
    const assignmentTranslationQuery: any = {
      where: {
        assignmentId: assignmentId,
      },
    };

    // Add active filtering for assignmentTranslation if not includeAll
    if (!includeAll) {
      assignmentTranslationQuery.where.assignment = {
        currentVersion: {
          isActive: true,
          isDraft: false,
        },
      };
    }

    const assignmentTranslationResult =
      await prisma.assignmentTranslation.deleteMany(assignmentTranslationQuery);
    const deletedAssignmentTranslations = assignmentTranslationResult.count;
    console.log(
      `✅ Deleted ${deletedAssignmentTranslations} assignment translation records`,
    );

    // Summary
    const totalDeleted =
      deletedQuestionTranslations +
      deletedVariantTranslations +
      deletedAssignmentTranslations;

    console.log(`\n📊 Deletion Summary for Assignment ${assignmentId}:`);
    console.log(`   🗂️  Question translations: ${deletedQuestionTranslations}`);
    console.log(`   🔄 Variant translations: ${deletedVariantTranslations}`);
    console.log(
      `   📋 Assignment translations: ${deletedAssignmentTranslations}`,
    );
    console.log(`   📊 Total deleted: ${totalDeleted}`);

    if (totalDeleted > 0) {
      console.log(
        `\n🔄 All translation records for assignment ${assignmentId} have been deleted.`,
      );
      console.log(`   These will be regenerated automatically when:`);
      console.log(
        `   1. A learner requests the assignment in any target language`,
      );
      console.log(`   2. You manually trigger translation via the API`);
      console.log(`   3. Assignment translation job is run`);
    } else {
      console.log(
        `\n📋 No translation records found for assignment ${assignmentId}.`,
      );
    }
  } catch (error) {
    console.error(
      `❌ Error deleting translations for assignment ${assignmentId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Delete bad translation records so they can be regenerated
 */
async function deleteAndRetranslate(
  translationIds: number[],
  includeAll = false,
): Promise<void> {
  console.log(
    `🗑️  Deleting ${translationIds.length} bad translation records...\n`,
  );

  const deletedRecords: Array<{
    id: number;
    questionId?: number;
    variantId?: number;
    languageCode: string;
  }> = [];

  for (const translationId of translationIds) {
    try {
      // Get the translation record before deletion for logging, including active status checks
      const translation = await prisma.translation.findUnique({
        where: { id: translationId },
        include: {
          question: {
            include: {
              assignment: {
                include: {
                  currentVersion: true,
                },
              },
            },
          },
          variant: {
            include: {
              variantOf: {
                include: {
                  assignment: {
                    include: {
                      currentVersion: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!translation) {
        console.log(`❌ Translation record ${translationId} not found`);
        continue;
      }

      // Check if the translation is for an active question/variant (unless includeAll flag is set)
      if (!includeAll) {
        let isActive = false;
        if (translation.question) {
          isActive =
            !translation.question.isDeleted &&
            translation.question.assignment?.currentVersion?.isActive ===
              true &&
            translation.question.assignment?.currentVersion?.isDraft === false;
        } else if (translation.variant) {
          isActive =
            !translation.variant.isDeleted &&
            !translation.variant.variantOf.isDeleted &&
            translation.variant.variantOf.assignment?.currentVersion
              ?.isActive === true &&
            translation.variant.variantOf.assignment?.currentVersion
              ?.isDraft === false;
        }

        if (!isActive) {
          console.log(
            `⚠️  Skipping deletion of translation ${translationId} - associated question/variant is not active or in an inactive assignment version`,
          );
          continue;
        }
      }

      // Delete the record
      await prisma.translation.delete({
        where: { id: translationId },
      });

      deletedRecords.push({
        id: translation.id,
        questionId: translation.questionId || undefined,
        variantId: translation.variantId || undefined,
        languageCode: translation.languageCode,
      });

      console.log(
        `✅ Deleted translation record ${translationId} (${translation.languageCode})`,
      );
    } catch (error) {
      console.log(`❌ Error deleting record ${translationId}:`, error);
    }
  }

  if (deletedRecords.length > 0) {
    console.log(
      `\n🔄 Deleted ${deletedRecords.length} translation records. These will be regenerated automatically when:`,
    );
    console.log(
      `   1. A learner requests the assignment in the target language`,
    );
    console.log(`   2. You manually trigger translation via the API`);
    console.log(`   3. Assignment translation job is run`);

    console.log(`\n📋 Deleted records summary:`);
    for (const record of deletedRecords) {
      if (record.questionId) {
        console.log(
          `   Question ${record.questionId} -> ${record.languageCode} (Translation ID: ${record.id})`,
        );
      } else if (record.variantId) {
        console.log(
          `   Variant ${record.variantId} -> ${record.languageCode} (Translation ID: ${record.id})`,
        );
      }
    }
  }
}

/**
 * Main CLI function
 */
async function main() {
  const command = process.argv[2];
  const isDebugMode = process.argv.includes("--debug");
  const includeAll = process.argv.includes("--include-all");

  // Parse limit parameter (--limit=N)
  let limit: number | undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (limitArg) {
    const limitValue = parseInt(limitArg.split("=")[1]);
    if (!isNaN(limitValue) && limitValue > 0) {
      limit = limitValue;
    } else {
      console.log(
        "❌ Invalid limit value. Please use --limit=N where N is a positive number.",
      );
      return;
    }
  }

  // Parse assignment IDs parameter (--assignments=1,2,3)
  let assignmentIds: number[] | undefined;
  const assignmentsArg = process.argv.find((arg) =>
    arg.startsWith("--assignments="),
  );
  if (assignmentsArg) {
    const assignmentValues = assignmentsArg
      .split("=")[1]
      .split(",")
      .map((id) => parseInt(id.trim()));
    if (assignmentValues.every((id) => !isNaN(id) && id > 0)) {
      assignmentIds = assignmentValues;
    } else {
      console.log(
        "❌ Invalid assignment IDs. Please use --assignments=1,2,3 where all values are positive numbers.",
      );
      return;
    }
  }

  if (isDebugMode) {
    console.log("🐛 Debug mode enabled - showing detailed detection info\n");
  }

  if (includeAll) {
    console.log(
      "🌐 Include-all mode enabled - scanning ALL questions (active, deleted, draft versions)\n",
    );
  }

  if (limit) {
    console.log(`📏 Limit set to ${limit} records\n`);
  }

  if (assignmentIds && assignmentIds.length > 0) {
    console.log(
      `🎯 Filtering to assignment IDs: ${assignmentIds.join(", ")}\n`,
    );
  }

  switch (command) {
    case "find-bad": {
      try {
        const badTranslations = await findBadTranslations(
          isDebugMode,
          limit,
          assignmentIds,
          includeAll,
        );

        console.log(
          `\n📊 RESULTS: Found ${badTranslations.length} translation records with language mismatches\n`,
        );

        if (badTranslations.length > 0) {
          console.log("💾 Bad Translation Record IDs:");
          console.log(badTranslations.map((bt) => bt.id).join(","));

          console.log("\n📋 Detailed Report:");
          console.log("─".repeat(120));
          console.log(
            "ID".padEnd(8) +
              "Q ID".padEnd(8) +
              "V ID".padEnd(8) +
              "Expected".padEnd(12) +
              "Detected".padEnd(12) +
              "Issue",
          );
          console.log("─".repeat(120));

          for (const bt of badTranslations) {
            console.log(
              String(bt.id).padEnd(8) +
                String(bt.questionId || "N/A").padEnd(8) +
                String(bt.variantId || "N/A").padEnd(8) +
                bt.languageCode.padEnd(12) +
                bt.detectedLanguage.padEnd(12) +
                bt.issue.slice(0, 60) +
                (bt.issue.length > 60 ? "..." : ""),
            );
          }

          if (badTranslations.length > 0) {
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Review the bad translations above`);
            console.log(
              `   2. Retranslate them: npm run translation-audit retranslate ${badTranslations
                .map((bt) => bt.id)
                .join(",")}`,
            );
            console.log(
              `   3. Or delete and regenerate: npm run translation-audit delete-and-retranslate <IDs>`,
            );
          }
        } else {
          console.log(
            "✅ No bad translations found! All translations match their expected language codes.",
          );
        }
      } catch (error) {
        console.error("❌ Error finding bad translations:", error);
      }

      break;
    }
    case "retranslate": {
      const idsArgument = process.argv[3];
      if (!idsArgument) {
        console.log(
          "❌ Please provide comma-separated translation IDs to analyze for retranslation",
        );
        console.log(
          "Usage: npm run translation-audit retranslate 123,456,789 [--assignments=1,2,3]",
        );
        return;
      }

      try {
        const translationIds = idsArgument
          .split(",")
          .map((id) => Number.parseInt(id.trim()))
          .filter((id) => !isNaN(id));

        if (translationIds.length === 0) {
          console.log("❌ No valid translation IDs provided");
          return;
        }

        // Extract single assignment ID for retranslation (use first one if multiple provided)
        const singleAssignmentId =
          assignmentIds && assignmentIds.length > 0
            ? assignmentIds[0]
            : undefined;

        if (singleAssignmentId) {
          console.log(
            `🎯 Using assignment ID ${singleAssignmentId} for translation operations\n`,
          );
        }

        // Use batch processing for better performance
        await markForRetranslationBatch(
          translationIds,
          singleAssignmentId,
          includeAll,
        );
      } catch (error) {
        console.error("❌ Error analyzing records for retranslation:", error);
      }

      break;
    }
    case "delete-and-retranslate": {
      const idsArgument = process.argv[3];
      if (!idsArgument) {
        console.log(
          "❌ Please provide comma-separated translation IDs to delete and retranslate",
        );
        console.log(
          "Usage: npm run translation-audit delete-and-retranslate 123,456,789",
        );
        console.log(
          "⚠️  WARNING: This will permanently delete the translation records!",
        );
        return;
      }

      // Safety confirmation
      console.log(
        "⚠️  WARNING: You are about to permanently delete translation records!",
      );
      console.log(
        "   This action cannot be undone. The records will be regenerated automatically later.",
      );
      console.log(
        "   Press Ctrl+C to cancel or wait 5 seconds to continue...\n",
      );

      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        const translationIds = idsArgument
          .split(",")
          .map((id) => Number.parseInt(id.trim()))
          .filter((id) => !isNaN(id));

        if (translationIds.length === 0) {
          console.log("❌ No valid translation IDs provided");
          return;
        }

        await deleteAndRetranslate(translationIds, includeAll);
      } catch (error) {
        console.error("❌ Error deleting and retranslating records:", error);
      }

      break;
    }
    case "delete-only": {
      const idsArgument = process.argv[3];
      if (!idsArgument) {
        console.log(
          "❌ Please provide comma-separated translation IDs to delete",
        );
        console.log("Usage: npm run translation-audit delete-only 123,456,789");
        console.log(
          "⚠️  WARNING: This will permanently delete the translation records!",
        );
        return;
      }

      // Safety confirmation
      console.log(
        "⚠️  WARNING: You are about to permanently delete translation records!",
      );
      console.log(
        "   This action cannot be undone. The records will be regenerated automatically later.",
      );
      console.log(
        "   Press Ctrl+C to cancel or wait 5 seconds to continue...\n",
      );

      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        const translationIds = idsArgument
          .split(",")
          .map((id) => Number.parseInt(id.trim()))
          .filter((id) => !isNaN(id));

        if (translationIds.length === 0) {
          console.log("❌ No valid translation IDs provided");
          return;
        }

        await deleteTranslationsOnly(translationIds, includeAll);
      } catch (error) {
        console.error("❌ Error deleting records:", error);
      }

      break;
    }
    case "delete-assignment": {
      const assignmentIdArg = process.argv[3];
      if (!assignmentIdArg) {
        console.log("❌ Please provide an assignment ID");
        console.log(
          "Usage: npm run translation-audit delete-assignment 123 [--include-all]",
        );
        console.log(
          "⚠️  WARNING: This will delete ALL translation records for the assignment!",
        );
        return;
      }

      const assignmentIdToDelete = Number.parseInt(assignmentIdArg.trim());
      if (isNaN(assignmentIdToDelete)) {
        console.log("❌ Invalid assignment ID provided");
        return;
      }

      // Safety confirmation
      console.log(
        "🚨 DANGER: You are about to delete ALL translation records for assignment " +
          assignmentIdToDelete +
          "!",
      );
      console.log("   This includes:");
      console.log("   - All question translations");
      console.log("   - All variant translations");
      console.log("   - All assignment-level translations");
      console.log("   This action cannot be undone!");
      console.log(
        "   Press Ctrl+C to cancel or wait 10 seconds to continue...\n",
      );

      await new Promise((resolve) => setTimeout(resolve, 10000));

      try {
        await deleteAssignmentTranslations(assignmentIdToDelete, includeAll);
      } catch (error) {
        console.error("❌ Error deleting assignment translations:", error);
      }

      break;
    }
    default: {
      console.log(`
🔧 Translation Audit CLI Tool

Usage:
  npm run translation-audit find-bad [--debug] [--limit=N] [--assignments=1,2,3] [--include-all] - Find translation records with language mismatches
  npm run translation-audit retranslate 123,456,789 [--assignments=N] [--include-all]            - Retranslate specific record IDs using batch processing
  npm run translation-audit delete-only 123,456,789 [--include-all]                             - Delete translation records only (they will regenerate)
  npm run translation-audit delete-assignment 123 [--include-all]                               - Delete ALL translations for an assignment (DANGEROUS!)
  npm run translation-audit delete-and-retranslate 123,456 [--assignments=1,2,3] [--include-all] - Delete bad translations (they will regenerate)

Examples:
  npm run translation-audit find-bad                                    - Scan active translation records
  npm run translation-audit find-bad --include-all                      - Scan ALL translation records (including deleted/draft)
  npm run translation-audit find-bad --debug                            - Show detailed detection info for troubleshooting
  npm run translation-audit find-bad --limit=100                        - Scan only the first 100 records
  npm run translation-audit find-bad --assignments=42,55                - Scan only translations from assignments 42 and 55
  npm run translation-audit find-bad --debug --limit=50 --assignments=42 - Debug mode with 50 record limit for assignment 42
  npm run translation-audit retranslate 45,67,89                        - Actually retranslate and update database
  npm run translation-audit retranslate 45,67,89 --assignments=42       - Retranslate using assignment 42's context for better quality
  npm run translation-audit retranslate 45,67,89 --include-all          - Retranslate including inactive questions/variants
  npm run translation-audit delete-only 45,67,89                        - Delete translation records only (no retranslation)
  npm run translation-audit delete-assignment 42                        - Delete ALL translations for assignment 42 (DANGEROUS!)
  npm run translation-audit delete-assignment 42 --include-all          - Delete ALL translations including inactive versions
  npm run translation-audit delete-and-retranslate 45,67,89

Options:
  --debug           Show detailed language detection information for troubleshooting
  --limit=N         Limit scanning to first N translation records (useful for testing/sampling)
  --assignments=1,2 Filter scanning to specific assignment IDs, or provide assignment context for retranslation
  --include-all     Include ALL questions (active, deleted, draft versions) - no filtering

Workflow:
  1. Run 'find-bad' to identify problematic translations (active questions only by default)
  2. Use '--include-all' to scan deleted questions and draft assignment versions
  3. Use '--limit' for quick testing or large databases
  4. Use '--debug' flag to see detailed language detection info
  5. Run 'retranslate' to fix specific records using GPT-5-nano
  6. Run 'delete-and-retranslate' to remove bad translations (safe - they regenerate automatically)

Environment Variables:
  DATABASE_URL - PostgreSQL connection string (required)
  OPENAI_API_KEY - Required for 'retranslate' command and enhanced language detection via project's TranslationService
`);
    }
  }

  await prisma.$disconnect();
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

// Run the CLI
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}
