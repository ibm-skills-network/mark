import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";
import cld from "cld";

import { PROMPT_PROCESSOR } from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { ITranslationService } from "../interfaces/translation.interface";
import { Choice } from "../../../../assignment/dto/update.questions.request.dto";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { decodeIfBase64 } from "src/helpers/decoder";

@Injectable()
export class TranslationService implements ITranslationService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: TranslationService.name });
  }

  /**
   * Detect the language of text using cld library
   */

  async getLanguageCode(text: string): Promise<string> {
    if (!text) return "unknown";

    const decodedText = decodeIfBase64(text) || text;

    try {
      const response = await cld.detect(decodedText);
      return response.languages[0].code;
    } catch (error) {
      this.logger.error(
        `Error detecting language: ${error instanceof Error ? error.message : "Unknown error"}`,
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
        target_language: targetLanguage,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-4o-mini",
      );

      const parsedResponse = await parser.parse(response);
      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(
        `Error translating question: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to translate question",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  /**
   * Generate comprehensive translations for choice objects including feedback
   *
   * @param choices - Original choices array to translate
   * @param assignmentId - The assignment ID for tracking
   * @param targetLanguage - The target language code
   * @returns Translated choices with all content translated
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
        `Translating text for ${choices.length} choices to ${targetLanguage}`,
      );

      const translatedChoices = await Promise.all(
        choices.map(async (choice) => {
          const translatedChoice = { ...choice };
          const choiceText = translatedChoice.choice;
          if (choiceText) {
            try {
              const translatedText = await this.translateText(
                choiceText,
                targetLanguage,
                assignmentId,
              );

              if (translatedChoice.choice !== undefined) {
                translatedChoice.choice = translatedText;
              }
            } catch (error) {
              this.logger.error(
                `Failed to translate choice text: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          return translatedChoice;
        }),
      );

      return translatedChoices;
    } catch (error) {
      this.logger.error(
        `Error translating choice text: ${error instanceof Error ? error.message : String(error)}`,
      );

      return choices;
    }
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
        target_language: targetLanguage,
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
        "gpt-4o-mini",
      );

      const parsedResponse = await parser.parse(response);

      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(
        `Error translating text: ${error instanceof Error ? error.message : "Unknown error"}`,
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
