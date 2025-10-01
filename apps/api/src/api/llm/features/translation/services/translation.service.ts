/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/prefer-module */
import * as fs from "node:fs";
import * as path from "node:path";
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import cld from "cld";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { decodeIfBase64 } from "src/helpers/decoder";
import { Logger } from "winston";
import { z } from "zod";
import { Choice } from "../../../../assignment/dto/update.questions.request.dto";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { PROMPT_PROCESSOR } from "../../../llm.constants";
import { ITranslationService } from "../interfaces/translation.interface";

interface LanguageMapping {
  code: string;
  name: string;
}

@Injectable()
export class TranslationService implements ITranslationService {
  private readonly logger: Logger;
  private languageMap: Map<string, string> = new Map();

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: TranslationService.name });
    this.loadLanguageMap();
  }

  /**
   * Load language mappings from languages.json file
   */
  private loadLanguageMap(): void {
    try {
      // Try multiple possible paths for the languages.json file
      const possiblePaths = [
        path.join(process.cwd(), "../../apps/web/public/languages.json"), // When running from api directory
        path.join(process.cwd(), "../web/public/languages.json"), // Alternative path
        path.join(
          __dirname,
          "../../../../../../apps/web/public/languages.json",
        ), // From compiled js location
        path.join(__dirname, "../../../../../web/public/languages.json"), // Alternative compiled location
      ];

      let languagesPath: string | null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          languagesPath = testPath;
          break;
        }
      }

      if (languagesPath) {
        const languagesData = fs.readFileSync(languagesPath, "utf8");
        const languages: LanguageMapping[] = JSON.parse(languagesData);

        for (const lang of languages) {
          this.languageMap.set(lang.code, lang.name);
        }

        this.logger.debug(
          `Loaded ${this.languageMap.size} language mappings from ${languagesPath}`,
        );
      } else {
        this.logger.warn(
          "Languages file not found in any expected location, using default mappings",
        );
        this.loadDefaultLanguageMap();
      }
    } catch (error) {
      this.logger.error(
        `Error loading language mappings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      this.loadDefaultLanguageMap();
    }
  }

  /**
   * Load default language mappings as fallback
   */
  private loadDefaultLanguageMap(): void {
    const defaultMappings: LanguageMapping[] = [
      { code: "en", name: "English" },
      { code: "id", name: "Bahasa Indonesia" },
      { code: "de", name: "Deutsch" },
      { code: "es", name: "Español" },
      { code: "fr", name: "Français" },
      { code: "it", name: "Italiano" },
      { code: "hu", name: "Magyar" },
      { code: "nl", name: "Nederlands" },
      { code: "pl", name: "Polski" },
      { code: "pt", name: "Português" },
      { code: "sv", name: "Svenska" },
      { code: "tr", name: "Türkçe" },
      { code: "el", name: "Ελληνικά" },
      { code: "kk", name: "Қазақ тілі" },
      { code: "ru", name: "Русский" },
      { code: "uk-UA", name: "Українська" },
      { code: "ar", name: "العربية" },
      { code: "hi", name: "हिन्दी" },
      { code: "th", name: "ไทย" },
      { code: "ko", name: "한국어" },
      { code: "zh-CN", name: "简体中文" },
      { code: "zh-TW", name: "繁體中文" },
      { code: "ja", name: "日本語" },
    ];

    for (const lang of defaultMappings) {
      this.languageMap.set(lang.code, lang.name);
    }
  }

  /**
   * Get language name from language code
   */
  private getLanguageName(languageCode: string): string {
    return this.languageMap.get(languageCode) || languageCode;
  }

  /**
   * Batch detect languages for multiple texts using CLD first, falling back to GPT-5-nano
   */
  async batchGetLanguageCodes(
    texts: string[],
    assignmentId = 1,
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    // Step 1: Try CLD on all texts first (fast and free)
    const results: unknown[] = Array.from({ length: texts.length }).fill(
      "unknown",
    );
    const textsNeedingGPT: Array<{ text: string; index: number }> = [];

    for (const [index, text] of texts.entries()) {
      if (!text || !text.trim()) {
        continue;
      }

      const decodedText = decodeIfBase64(text) || text;

      try {
        const cldResponse = await cld.detect(decodedText);
        const detectedLanguage = cldResponse.languages[0];

        // Check if CLD is confident enough
        if (detectedLanguage && detectedLanguage.percent >= 80) {
          results[index] = detectedLanguage.code;
          this.logger.debug(
            `CLD batch detected language for text ${index}: ${detectedLanguage.code} (${detectedLanguage.percent}% confidence)`,
          );
        } else {
          // Mark for GPT-5-nano processing
          textsNeedingGPT.push({
            text: decodedText.slice(0, 500),
            index: index,
          });
        }
      } catch {
        // Mark for GPT-5-nano processing
        textsNeedingGPT.push({
          text: decodedText.slice(0, 500),
          index: index,
        });
      }
    }

    // Step 2: Use GPT-5-nano for texts that CLD couldn't handle confidently
    if (
      textsNeedingGPT.length === 0 &&
      results.every((r) => typeof r === "string")
    ) {
      return results;
    }

    this.logger.debug(
      `CLD processed ${texts.length - textsNeedingGPT.length}/${
        texts.length
      } texts confidently, using GPT-5-nano for ${
        textsNeedingGPT.length
      } remaining texts`,
    );

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        detections: z.array(
          z.object({
            textIndex: z
              .number()
              .describe("The index of the text in the input array"),
            languageCode: z
              .string()
              .describe("The detected language code (e.g., 'en', 'es', 'fr')"),
            confidence: z
              .number()
              .min(0)
              .max(1)
              .describe("Confidence score between 0 and 1"),
          }),
        ),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Create input texts for the model (only the texts that need GPT processing)
    const inputTexts = textsNeedingGPT
      .map((item, index) => `Text ${index}: ${item.text}`)
      .join("\n\n");

    const prompt = new PromptTemplate({
      template: `You are a language detection expert. Analyze the following texts and identify their languages.

TEXTS TO ANALYZE:
{texts}

INSTRUCTIONS:
1. For each text, detect its language
2. Return the standard ISO 639-1 language code (e.g., 'en' for English, 'es' for Spanish)
3. For Chinese, specify 'zh-CN' for simplified or 'zh-TW' for traditional
4. If you cannot determine the language, return 'unknown' as the language code
5. Provide a confidence score between 0 and 1 for each detection
6. Return results for all texts in the order they appear (Text 0, Text 1, etc.)

{format_instructions}`,
      inputVariables: [],
      partialVariables: {
        texts: inputTexts,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-5-nano",
      );

      const parsedResponse = await parser.parse(response);

      // Map GPT-5-nano results back to the original result array
      for (const detection of parsedResponse.detections) {
        const gptTextItem = textsNeedingGPT[detection.textIndex];
        if (gptTextItem) {
          results[gptTextItem.index] = detection.languageCode;

          this.logger.debug(
            `GPT-5-nano batch detected language for text ${gptTextItem.index}: ${detection.languageCode} (${detection.confidence} confidence)`,
          );

          if (detection.confidence < 0.5) {
            this.logger.warn(
              `Low confidence (${detection.confidence}) in GPT-5-nano batch language detection for text at index ${gptTextItem.index}`,
            );
          }
        }
      }

      if (results.every((r) => typeof r === "string")) {
        return results;
      }
    } catch (error) {
      this.logger.error(
        `Error in batch language detection with GPT-5-nano: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      // Fallback to individual detection for critical cases
      return Promise.all(
        texts.map((text) => this.getLanguageCode(text, assignmentId)),
      );
    }
  }

  /**
   * Detect the language of text using CLD first, falling back to GPT-5-nano
   */
  async getLanguageCode(text: string, assignmentId = 1): Promise<string> {
    if (!text) return "unknown";

    const decodedText = decodeIfBase64(text) || text;

    // Step 1: Try CLD first (fast and free)
    try {
      const cldResponse = await cld.detect(decodedText);
      const detectedLanguage = cldResponse.languages[0];

      // Check if CLD is confident enough
      if (detectedLanguage && detectedLanguage.percent >= 80) {
        this.logger.debug(
          `CLD detected language: ${detectedLanguage.code} (${detectedLanguage.percent}% confidence)`,
        );
        return detectedLanguage.code;
      } else if (detectedLanguage) {
        this.logger.debug(
          `CLD low confidence (${detectedLanguage.percent}%), falling back to GPT-5-nano`,
        );
        // Fall through to GPT-5-nano
      }
    } catch (cldError) {
      this.logger.debug(
        `CLD failed: ${
          cldError instanceof Error ? cldError.message : "Unknown error"
        }, falling back to GPT-5-nano`,
      );
      // Fall through to GPT-5-nano
    }

    // Step 2: Fall back to GPT-5-nano for difficult cases
    const textSample = decodedText.slice(0, 500);

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        languageCode: z
          .string()
          .describe(
            "The detected language code (e.g., 'en', 'es', 'fr', 'zh-CN')",
          ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Confidence score between 0 and 1"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `You are a language detection expert. Analyze the following text and identify its language.

TEXT:
{text}

INSTRUCTIONS:
1. Detect the language of the text
2. Return the standard ISO 639-1 language code (e.g., 'en' for English, 'es' for Spanish)
3. For Chinese, specify 'zh-CN' for simplified or 'zh-TW' for traditional
4. If you cannot determine the language, return 'unknown' as the language code
5. Provide a confidence score between 0 and 1

{format_instructions}`,
      inputVariables: [],
      partialVariables: {
        text: textSample,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-5-nano",
      );

      const parsedResponse = await parser.parse(response);

      this.logger.debug(
        `GPT-5-nano detected language: ${parsedResponse.languageCode} (${parsedResponse.confidence} confidence)`,
      );

      if (parsedResponse.confidence < 0.5) {
        this.logger.warn(
          `Low confidence (${
            parsedResponse.confidence
          }) in GPT-5-nano language detection for: "${textSample.slice(
            0,
            50,
          )}..."`,
        );
      }

      return parsedResponse.languageCode;
    } catch (error) {
      this.logger.error(
        `Error detecting language with GPT-5-nano: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return "unknown";
    }
  }

  /**
   * Translate a question to a target language
   */
  async generateQuestionTranslation(
    assignmentId: number,
    questionText: string,
    targetLanguage: string,
  ): Promise<string> {
    const decodedQuestionText = decodeIfBase64(questionText) || questionText;

    const cleanedText = decodedQuestionText.replaceAll(/<[^>]*>?/gm, "");

    // Convert language code to language name for the LLM
    const targetLanguageName = this.getLanguageName(targetLanguage);

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        translatedText: z.string().nonempty("Translated text cannot be empty"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: this.getQuestionTranslationTemplate(),
      inputVariables: [],
      partialVariables: {
        question_text: cleanedText,
        target_language: targetLanguageName,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-4o-mini",
      );

      const parsedResponse = await parser.parse(response);
      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(
        `Error translating question: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to translate question",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  /**
   * Generate comprehensive translations for choice objects including feedback
   * Validates existing translations and retranslates if language doesn't match
   *
   * @param choices - Original choices array to translate
   * @param assignmentId - The assignment ID for tracking
   * @param targetLanguage - The target language code
   * @returns Translated choices with both choice text and feedback translated and validated
   */
  async generateChoicesTranslation(
    choices: Choice[] | null | undefined,
    assignmentId: number,
    targetLanguage: string,
  ): Promise<Choice[] | null | undefined> {
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      this.logger.debug(
        `No choices to translate or choices is not an array: ${typeof choices}`,
      );
      return choices;
    }

    try {
      this.logger.debug(
        `Batch translating text for ${choices.length} choices to ${targetLanguage}`,
      );

      // Collect all texts for batch language detection
      const textsToCheck: string[] = [];
      const textMap: Array<{
        choiceIndex: number;
        type: "choice" | "feedback";
        textIndex: number;
      }> = [];

      for (const [choiceIndex, choice] of choices.entries()) {
        if (choice.choice) {
          textMap.push({
            choiceIndex,
            type: "choice",
            textIndex: textsToCheck.length,
          });
          textsToCheck.push(choice.choice);
        }
        if (choice.feedback) {
          textMap.push({
            choiceIndex,
            type: "feedback",
            textIndex: textsToCheck.length,
          });
          textsToCheck.push(choice.feedback);
        }
      }

      // Batch language detection
      let needsTranslationFlags: boolean[] = [];
      if (textsToCheck.length > 0) {
        needsTranslationFlags = await this.batchShouldRetranslate(
          textsToCheck,
          targetLanguage,
          assignmentId,
        );
      }

      // Process translations based on batch results
      const translatedChoices = await Promise.all(
        choices.map(async (choice, choiceIndex) => {
          const translatedChoice = { ...choice };

          // Handle choice text
          const choiceMapping = textMap.find(
            (m) => m.choiceIndex === choiceIndex && m.type === "choice",
          );
          if (choiceMapping && needsTranslationFlags[choiceMapping.textIndex]) {
            try {
              const translatedText = await this.translateText(
                choice.choice,
                targetLanguage,
                assignmentId,
              );
              translatedChoice.choice = translatedText;
              this.logger.debug(
                `Batch retranslated choice text to ${targetLanguage}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to translate choice text: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          // Handle feedback text
          const feedbackMapping = textMap.find(
            (m) => m.choiceIndex === choiceIndex && m.type === "feedback",
          );
          if (
            feedbackMapping &&
            needsTranslationFlags[feedbackMapping.textIndex]
          ) {
            try {
              const translatedFeedback = await this.translateText(
                choice.feedback,
                targetLanguage,
                assignmentId,
              );
              translatedChoice.feedback = translatedFeedback;
              this.logger.debug(
                `Batch retranslated choice feedback to ${targetLanguage}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to translate choice feedback: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          return translatedChoice;
        }),
      );

      return translatedChoices;
    } catch (error) {
      this.logger.error(
        `Error translating choice text: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return choices;
    }
  }

  /**
   * Batch determine if texts should be retranslated based on language detection
   *
   * @param texts - Array of texts to check
   * @param targetLanguage - The expected target language code
   * @param assignmentId - The assignment ID for tracking
   * @returns Promise<boolean[]> - array of booleans indicating which texts need retranslation
   */
  private async batchShouldRetranslate(
    texts: string[],
    targetLanguage: string,
    assignmentId: number,
  ): Promise<boolean[]> {
    if (texts.length === 0) return [];

    // Filter out empty texts
    const validTexts = texts.filter((text) => text && text.trim().length > 0);
    if (validTexts.length === 0) {
      return texts.map(() => false);
    }

    try {
      const detectedLanguages = await this.batchGetLanguageCodes(
        texts,
        assignmentId,
      );

      return texts.map((text, index) => {
        if (!text || text.trim().length === 0) {
          return false;
        }

        const detectedLanguage = detectedLanguages[index];

        // Skip retranslation if we can't detect the language
        if (detectedLanguage === "unknown") {
          this.logger.debug(
            `Could not detect language for text, skipping validation: "${text.slice(
              0,
              50,
            )}..."`,
          );
          return false;
        }

        // Normalize language codes for comparison
        const normalizedDetected = this.normalizeLanguageCode(detectedLanguage);
        const normalizedTarget = this.normalizeLanguageCode(targetLanguage);

        const needsRetranslation = normalizedDetected !== normalizedTarget;

        if (needsRetranslation) {
          this.logger.info(
            `Language mismatch detected in batch. Expected: ${normalizedTarget}, Found: ${normalizedDetected}. Text: "${text.slice(
              0,
              50,
            )}..."`,
          );
        }

        return needsRetranslation;
      });
    } catch (error) {
      this.logger.error(
        `Error during batch language validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Fallback to individual validation
      return Promise.all(
        texts.map((text) =>
          this.shouldRetranslate(text, targetLanguage, assignmentId),
        ),
      );
    }
  }

  /**
   * Determine if text should be retranslated based on language detection
   *
   * @param text - The text to check
   * @param targetLanguage - The expected target language code
   * @param assignmentId - The assignment ID for tracking
   * @returns Promise<boolean> - true if text needs retranslation
   */
  private async shouldRetranslate(
    text: string,
    targetLanguage: string,
    assignmentId: number,
  ): Promise<boolean> {
    if (!text || text.trim().length === 0) {
      return false;
    }

    try {
      const detectedLanguage = await this.getLanguageCode(text, assignmentId);

      // Skip retranslation if we can't detect the language
      if (detectedLanguage === "unknown") {
        this.logger.debug(
          `Could not detect language for text, skipping validation: "${text.slice(
            0,
            50,
          )}..."`,
        );
        return false;
      }

      // Normalize language codes for comparison
      const normalizedDetected = this.normalizeLanguageCode(detectedLanguage);
      const normalizedTarget = this.normalizeLanguageCode(targetLanguage);

      const needsRetranslation = normalizedDetected !== normalizedTarget;

      if (needsRetranslation) {
        this.logger.info(
          `Language mismatch detected. Expected: ${normalizedTarget}, Found: ${normalizedDetected}. Text: "${text.slice(
            0,
            50,
          )}..."`,
        );
      } else {
        this.logger.debug(`Text language matches target: ${normalizedTarget}`);
      }

      return needsRetranslation;
    } catch (error) {
      this.logger.error(
        `Error during language validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // On error, assume retranslation is needed to be safe
      return true;
    }
  }

  /**
   * Normalize language codes for comparison (handles variants like zh-CN vs zh)
   *
   * @param languageCode - The language code to normalize
   * @returns string - The normalized language code
   */
  private normalizeLanguageCode(languageCode: string): string {
    if (!languageCode) return "unknown";

    const code = languageCode.toLowerCase();

    // Handle common language variants
    const languageMap: Record<string, string> = {
      "zh-cn": "zh",
      "zh-tw": "zh",
      "zh-hk": "zh",
      "en-us": "en",
      "en-gb": "en",
      "en-ca": "en",
      "es-es": "es",
      "es-mx": "es",
      "pt-br": "pt",
      "pt-pt": "pt",
      "fr-fr": "fr",
      "fr-ca": "fr",
      "de-de": "de",
      "it-it": "it",
      "ru-ru": "ru",
      "ja-jp": "ja",
      "ko-kr": "ko",
    };

    return languageMap[code] || code.split("-")[0];
  }

  /**
   * Translate arbitrary text to a target language
   */
  async translateText(
    text: string,
    targetLanguage: string,
    assignmentId: number,
  ): Promise<string> {
    if (!text) return "";

    const decodedText = decodeIfBase64(text) || text;

    // Convert language code to language name for the LLM
    const targetLanguageName = this.getLanguageName(targetLanguage);

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        translatedText: z.string().nonempty("Translated text cannot be empty"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: this.getGeneralTranslationTemplate(),
      inputVariables: [],
      partialVariables: {
        text: decodedText,
        target_language: targetLanguageName,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-4o-mini",
      );

      const parsedResponse = await parser.parse(response);

      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(
        `Error translating text: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to translate text",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private getQuestionTranslationTemplate(): string {
    return `
    You are a professional translator with expertise in educational content. Translate the following question into {target_language}:
    
    QUESTION:
    {question_text}
    
    TRANSLATION INSTRUCTIONS:
    1. Maintain the original meaning, context, and intent of the question.
    2. Adapt any idiomatic expressions or culture-specific references appropriately.
    3. Ensure the translation is natural and fluent in the target language.
    4. Preserve formatting elements such as bullet points or numbered lists.
    5. Translate any proper names only if they have standard translations in the target language.
    6. Preserve any words already in another language—tech terms, proper names, acronyms, quotes—exactly as written.
    
    {format_instructions}
    `;
  }

  private getChoicesTranslationTemplate(): string {
    return `
    You are a professional translator with expertise in educational content. Translate the following multiple-choice options into {target_language}:
    
    CHOICES:
    {choices_json}
    
    TRANSLATION INSTRUCTIONS:
    1. Maintain the original meaning, context, and correctness of each choice.
    2. Ensure the translations are natural and fluent in the target language.
    3. Preserve any formatting in the choices.
    4. Do not change which choice is marked as correct.
    5. Translate any proper names only if they have standard translations in the target language.
    
    {format_instructions}
    `;
  }

  private getGeneralTranslationTemplate(): string {
    return `
    You are translating educational content for students and teachers, ensuring clarity and an appropriate academic tone.
    
    TEXT TO TRANSLATE:
    {text}
    
    TARGET LANGUAGE:
    {target_language}
    
    TRANSLATION INSTRUCTIONS:
    1. Maintain the original meaning, context, and intent.
    2. Ensure the translation is natural and fluent in the target language.
    3. Preserve any formatting elements such as bullet points or numbered lists.
    4. Adapt any idiomatic expressions or culture-specific references appropriately.
    5. Translate any proper names only if they have standard translations in the target language.
    6. Preserve any words already in another language—tech terms, proper names, acronyms, quotes—exactly as written.

    {format_instructions}
    `;
  }
}
