import { Choice } from "../../../../assignment/dto/update.questions.request.dto";

export interface ITranslationService {
  /**
   * Detect the language of text
   */

  getLanguageCode(text: string, assignmentId?: number): Promise<string>;

  /**
   * Batch detect languages for multiple texts
   */
  batchGetLanguageCodes(
    texts: string[],
    assignmentId?: number,
  ): Promise<string[]>;

  /**
   * Translate a question to a target language
   */
  generateQuestionTranslation(
    assignmentId: number,
    questionText: string,
    targetLanguage: string,
  ): Promise<string>;

  /**
   * Translate choices to a target language
   */
  generateChoicesTranslation(
    choices: Choice[],
    assignmentId: number,
    targetLanguage: string,
  ): Promise<Choice[]>;

  /**
   * Translate arbitrary text to a target language
   */
  translateText(
    text: string,
    targetLanguage: string,
    assignmentId: number,
  ): Promise<string>;
}
