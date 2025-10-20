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

    // Check if this appears to be legitimate educational/technical content
    if (this.isEducationalContent(content)) {
      this.logger.debug(
        "Content appears to be educational/technical, allowing with less strict moderation",
      );
      return true;
    }

    try {
      const moderation = new OpenAIModerationChain();

      const { output: guardRailsResponse } = await moderation.invoke({
        input: content,
      });

      const isViolation =
        guardRailsResponse ===
        "Text was found that violates OpenAI's content policy.";

      if (isViolation) {
        this.logger.warn(
          `Content flagged by moderation: ${content.slice(0, 200)}...`,
        );
      }

      return !isViolation;
    } catch (error) {
      this.logger.error(
        `Error validating content: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return true;
    }
  }

  private isEducationalContent(content: string): boolean {
    const educationalIndicators = [
      // Security education keywords
      "xss",
      "cross-site scripting",
      "security",
      "vulnerability",
      "penetration testing",
      "cybersecurity",
      "sql injection",
      "csrf",
      "owasp",
      "security report",
      "vulnerability assessment",
      "security analysis",
      "ethical hacking",

      // Technical/programming education
      "algorithm",
      "data structure",
      "programming",
      "software development",
      "computer science",
      "technical documentation",
      "code example",
      "tutorial",
      "documentation",
      "technical report",
      "analysis",
      "implementation",

      // Academic indicators
      "research",
      "study",
      "analysis",
      "conclusion",
      "methodology",
      "findings",
      "bibliography",
      "references",
      "abstract",
      "introduction",
    ];

    const lowerContent = content.toLowerCase();
    const matchCount = educationalIndicators.filter((indicator) =>
      lowerContent.includes(indicator),
    ).length;

    // If multiple educational indicators are present, likely educational content
    return matchCount >= 2;
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
