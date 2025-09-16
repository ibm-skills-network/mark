import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { sanitize } from "isomorphic-dompurify";
import { OpenAIModerationChain } from "langchain/chains";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { IModerationService } from "../interfaces/moderation.interface";

@Injectable()
export class ModerationService implements IModerationService {
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: ModerationService.name });
  }

  /**
   * Check if content passes the guard rails
   */
  async validateContent(content: string): Promise<boolean> {
    if (!content) return true;

    try {
      const moderation = new OpenAIModerationChain();

      const { output: guardRailsResponse } = await moderation.invoke({
        input: content,
      });

      return (
        guardRailsResponse !==
        "Text was found that violates OpenAI's content policy."
      );
    } catch (error) {
      this.logger.error(
        `Error validating content: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return true;
    }
  }

  /**
   * Sanitize the content by removing any potentially harmful or unnecessary elements.
   * This method uses DOMPurify to remove scripts or other dangerous HTML content.
   */
  sanitizeContent(content: string): string {
    if (!content) return "";

    try {
      const sanitizedContent = sanitize(content);
      return sanitizedContent;
    } catch (error) {
      this.logger.error(
        `Error sanitizing content: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return content;
    }
  }

  /**
   * Moderate the content using OpenAI's moderation API
   */
  async moderateContent(
    content: string,
  ): Promise<{ flagged: boolean; details: string }> {
    if (!content) {
      return { flagged: false, details: "No content provided for moderation." };
    }

    try {
      const moderationChain = new OpenAIModerationChain();
      const moderationResult = await moderationChain.invoke({ input: content });

      const flagged = moderationResult.output !== "No issues found.";
      const details: string = moderationResult.output as string;

      return { flagged, details };
    } catch (error) {
      this.logger.error(
        `Content moderation failed: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Content moderation failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
