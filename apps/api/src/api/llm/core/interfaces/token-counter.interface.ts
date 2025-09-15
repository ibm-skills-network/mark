export interface ITokenCounter {
  /**
   * Count the number of tokens in a text
   * @param text The text to count tokens for
   * @param modelKey Optional model key for model-specific tokenization
   */
  countTokens(text: string, modelKey?: string): number;
}
