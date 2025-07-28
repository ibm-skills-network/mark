export interface IModerationService {
  /**
   * Check if content passes moderation guidelines
   */
  validateContent(content: string): Promise<boolean>;

  /**
   * Sanitize content by removing potentially harmful elements
   */
  sanitizeContent(content: string): string;

  /**
   * Get detailed moderation results for content
   */
  moderateContent(content: string): Promise<{
    flagged: boolean;
    details: string;
  }>;
}
