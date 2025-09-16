#!/usr/bin/env ts-node
/* eslint-disable */
import * as fs from "node:fs";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { PrismaClient } from "@prisma/client";
import { OpenAiLlmMiniService } from "src/api/llm/core/services/openai-llm-mini.service";
import { createLogger } from "winston";
import { PromptProcessorService } from "../api/llm/core/services/prompt-processor.service";
import { TokenCounterService } from "../api/llm/core/services/token-counter.service";

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

interface TranslationTask {
  id: number;
  translationId: number;
  languageCode: string;
  originalText: string;
  originalChoices: any;
  assignmentId: number;
}

interface TranslationResult {
  translationId: number;
  success: boolean;
  translatedText?: string;
  translatedChoices?: any;
  error?: string;
}

/**
 * GPT-5-nano translation fallback for script usage
 */
async function translateTextWithOpenAI(
  text: string,
  targetLanguage: string,
): Promise<string> {
  const languageNames: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    zh: "Chinese",
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
    ja: "Japanese",
    ko: "Korean",
    ar: "Arabic",
    hi: "Hindi",
    th: "Thai",
    tr: "Turkish",
    pl: "Polish",
    nl: "Dutch",
    sv: "Swedish",
    hu: "Hungarian",
    el: "Greek",
    "uk-ua": "Ukrainian",
    kk: "Kazakh",
    id: "Indonesian",
  };

  const targetLanguageName =
    languageNames[targetLanguage.toLowerCase()] || targetLanguage;

  try {
    const promptContent = `You are a professional translator. Translate the given text to ${targetLanguageName}. Maintain the original meaning, tone, and context. If the text contains technical terms, preserve them appropriately. Return only the translated text without any additional explanation.

Text to translate: ${text}`;

    const response = await gpt4MiniService.invoke([
      new HumanMessage(promptContent),
    ]);

    const translatedText = response.content?.trim();

    if (!translatedText) {
      throw new Error("No translation received from GPT-5-nano");
    }

    return translatedText;
  } catch (error) {
    throw new Error(
      `Translation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Direct OpenAI choice translation fallback for script usage
 */
async function translateChoicesWithOpenAI(
  choices: any[],
  targetLanguage: string,
): Promise<any[]> {
  // Process all choices in parallel
  return Promise.all(
    choices.map(async (choice) => {
      const translatedChoice = { ...choice };

      // Translate choice text and feedback in parallel
      const [translatedChoiceText, translatedFeedback] = await Promise.all([
        choice.choice
          ? translateTextWithOpenAI(choice.choice, targetLanguage).catch(
              (error) => {
                console.log(
                  `   ⚠️  Failed to translate choice text: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`,
                );
                return choice.choice; // Keep original if translation fails
              },
            )
          : Promise.resolve(choice.choice),
        choice.feedback
          ? translateTextWithOpenAI(choice.feedback, targetLanguage).catch(
              (error) => {
                console.log(
                  `   ⚠️  Failed to translate feedback text: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`,
                );
                return choice.feedback; // Keep original if translation fails
              },
            )
          : Promise.resolve(choice.feedback),
      ]);

      translatedChoice.choice = translatedChoiceText;
      translatedChoice.feedback = translatedFeedback;

      return translatedChoice;
    }),
  );
}

/**
 * Process a single translation task
 */
async function processTranslation(
  task: TranslationTask,
  index: number,
  total: number,
): Promise<TranslationResult> {
  console.log(
    `\n📝 [${index}/${total}] Processing translation ${task.translationId} (${task.languageCode})`,
  );

  try {
    let translatedText = "";
    let translatedChoices = null;

    // Translate main text
    try {
      console.log(`   Using assignment ID: ${task.assignmentId}`);
      translatedText = await translateTextWithOpenAI(
        task.originalText,
        task.languageCode,
      );

      console.log(`   ✅ Main text translated via service`);
    } catch (serviceError) {
      console.log(
        `   ⚠️  Service failed: ${
          serviceError instanceof Error ? serviceError.message : "Unknown error"
        }`,
      );
    }

    // Translate choices if they exist
    if (task.originalChoices) {
      let choicesArray = [];
      let originalChoicesData = task.originalChoices;

      // Handle case where choices might be stored as JSON string
      if (typeof task.originalChoices === "string") {
        try {
          originalChoicesData = JSON.parse(task.originalChoices);
        } catch (e) {
          console.log(`   ⚠️  Failed to parse choices JSON: ${e}`);
          translatedChoices = task.originalChoices; // Keep original if can't parse
        }
      }

      if (Array.isArray(originalChoicesData)) {
        choicesArray = originalChoicesData;
      } else if (
        typeof originalChoicesData === "object" &&
        originalChoicesData.choices
      ) {
        choicesArray = originalChoicesData.choices;
      }

      if (choicesArray.length > 0) {
        console.log(`   🔄 Translating ${choicesArray.length} choices...`);
        try {
          const translatedChoicesArray = await translateChoicesWithOpenAI(
            choicesArray,
            task.languageCode,
          );

          // Format the result to match the original structure
          if (Array.isArray(originalChoicesData)) {
            translatedChoices = translatedChoicesArray;
          } else {
            translatedChoices = {
              ...originalChoicesData,
              choices: translatedChoicesArray,
            };
          }

          console.log(`   ✅ Choices translated successfully`);
        } catch (serviceError) {
          console.log(
            `   ⚠️  Choice translation failed: ${
              serviceError instanceof Error
                ? serviceError.message
                : "Unknown error"
            }`,
          );
          console.log(`   📝 Keeping original choices as fallback`);
          translatedChoices = task.originalChoices; // Keep original as fallback
        }
      } else {
        console.log(`   📝 No choices found to translate`);
        translatedChoices = task.originalChoices;
      }
    }

    return {
      translationId: task.translationId,
      success: true,
      translatedText,
      translatedChoices,
    };
  } catch (error) {
    console.log(
      `   ❌ Translation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    return {
      translationId: task.translationId,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Batch process translation updates to database
 */
async function batchUpdateTranslations(
  results: TranslationResult[],
): Promise<{ success: number; failed: number }> {
  let successCount = 0;
  let failedCount = 0;

  // Update all successful translations in parallel
  await Promise.all(
    results.map(async (result) => {
      if (result.success && result.translatedText) {
        try {
          // Ensure choices are properly formatted for database storage
          const choicesData = result.translatedChoices
            ? typeof result.translatedChoices === "string"
              ? result.translatedChoices
              : JSON.stringify(result.translatedChoices)
            : result.translatedChoices;

          await prisma.translation.update({
            where: { id: result.translationId },
            data: {
              translatedText: result.translatedText,
              translatedChoices: choicesData,
            },
          });
          console.log(`✅ Updated translation ${result.translationId}`);
          successCount++;
        } catch (error) {
          console.log(
            `❌ Failed to update ${result.translationId}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
          failedCount++;
        }
      } else {
        failedCount++;
      }
    }),
  );

  return { success: successCount, failed: failedCount };
}

/**
 * Retranslate specific records and update them in the database with batch processing
 */
export async function markForRetranslationBatch(
  translationIds: number[],
  assignmentId?: number,
  includeAll = false,
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log(
      `❌ OPENAI_API_KEY is required for retranslation. Please set this environment variable.`,
    );
    return;
  }

  console.log(
    `🔄 Retranslating ${translationIds.length} records with batch processing...\n`,
  );

  const BATCH_SIZE = 5; // Process 5 translations at a time
  let totalSuccess = 0;
  let totalError = 0;

  // First, fetch all translation records with their source data
  console.log(`📥 Fetching translation records...`);
  const translationRecords = await Promise.all(
    translationIds.map((id) =>
      prisma.translation.findUnique({
        where: { id },
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
      }),
    ),
  );

  // Filter and prepare translation tasks
  const tasks: TranslationTask[] = [];
  for (const translation of translationRecords) {
    if (!translation) continue;

    // Check if active (unless includeAll)
    if (!includeAll) {
      let isActive = false;
      if (translation.question) {
        isActive =
          !translation.question.isDeleted &&
          translation.question.assignment?.currentVersion?.isActive === true &&
          translation.question.assignment?.currentVersion?.isDraft === false;
      } else if (translation.variant) {
        isActive =
          !translation.variant.isDeleted &&
          !translation.variant.variantOf.isDeleted &&
          translation.variant.variantOf.assignment?.currentVersion?.isActive ===
            true &&
          translation.variant.variantOf.assignment?.currentVersion?.isDraft ===
            false;
      }

      if (!isActive) {
        console.log(`⚠️  Skipping inactive translation ${translation.id}`);
        continue;
      }
    }

    // Prepare task
    let originalText = "";
    let originalChoices = null;
    let taskAssignmentId = 0;

    if (translation.question) {
      originalText = translation.question.question;
      originalChoices = translation.question.choices;
      taskAssignmentId = assignmentId || translation.question.assignmentId || 0;
    } else if (translation.variant) {
      originalText = translation.variant.variantContent;
      originalChoices = translation.variant.choices;
      taskAssignmentId =
        assignmentId || translation.variant.variantOf.assignmentId || 0;
    }

    if (originalText) {
      tasks.push({
        id: tasks.length,
        translationId: translation.id,
        languageCode: translation.languageCode,
        originalText,
        originalChoices,
        assignmentId: taskAssignmentId,
      });
    }
  }

  console.log(`📋 Prepared ${tasks.length} translations for processing\n`);

  // Process in batches
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, Math.min(i + BATCH_SIZE, tasks.length));
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tasks.length / BATCH_SIZE);

    console.log(
      `\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} translations)...`,
    );

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map((task, index) =>
        processTranslation(task, i + index + 1, tasks.length),
      ),
    );

    // Update database for this batch
    const { success, failed } = await batchUpdateTranslations(batchResults);
    totalSuccess += success;
    totalError += failed;

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < tasks.length) {
      console.log(`⏳ Waiting before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n📊 Retranslation Summary:`);
  console.log(`   ✅ Successful: ${totalSuccess}`);
  console.log(`   ❌ Errors: ${totalError}`);
  console.log(`   📋 Total: ${translationIds.length}`);

  if (totalSuccess > 0) {
    console.log(`\n🎉 Successfully retranslated ${totalSuccess} records!`);
  }

  if (totalError > 0) {
    console.log(
      `\n⚠️  ${totalError} records failed. Check the logs above for details.`,
    );
  }
}

// Export for use in main script
if (require.main === module) {
  // This file is not meant to be run directly
  console.log(
    "This is a module for batch translation processing. Import it from the main script.",
  );
}
