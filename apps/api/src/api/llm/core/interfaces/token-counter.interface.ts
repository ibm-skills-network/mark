export interface ITokenCounter {
  /**
   * Count the number of tokens in a text
   */
  countTokens(text: string): number;
}
