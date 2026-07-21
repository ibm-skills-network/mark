export type ModerationAction = "allow" | "allow_with_log" | "block_severe";

export interface ModerationVerdict {
  action: ModerationAction;
  flaggedCategories: string[];
  severeCategories: string[];
}

export interface IModerationService {
  /**
   * Get a category-level moderation verdict for content (and optionally
   * images) using OpenAI's moderations API.
   */
  assessContent(
    content: string,
    imageUrls?: string[],
  ): Promise<ModerationVerdict>;

  /**
   * Check if content passes moderation guidelines. Kept for authoring;
   * resolves to false ONLY when a severe category is flagged.
   */
  validateContent(content: string): Promise<boolean>;

  /**
   * Sanitize content by removing potentially harmful elements
   */
  sanitizeContent(content: string): string;
}
