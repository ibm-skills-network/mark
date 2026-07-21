import { Inject, Injectable } from "@nestjs/common";
import { sanitize } from "isomorphic-dompurify";
import OpenAI from "openai";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  IModerationService,
  ModerationVerdict,
} from "../interfaces/moderation.interface";
import { logAiInvocation } from "../utils/ai-invocation-log.util";

const MODERATION_MODEL = "omni-moderation-latest";

/**
 * The moderations endpoint does not expose which snapshot ran, so
 * invocations are logged under this generic key.
 */
const MODERATION_MODEL_KEY = "openai-moderation";

const KNOWN_CATEGORIES = new Set([
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
]);

const DEFAULT_SEVERE_CATEGORIES = ["sexual/minors"];

export function parseSevereCategories(
  raw: string,
  logger: Logger,
): Set<string> {
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return new Set(DEFAULT_SEVERE_CATEGORIES);

  const severe = new Set<string>();
  for (const name of names) {
    if (KNOWN_CATEGORIES.has(name)) {
      severe.add(name);
    } else {
      logger.warn("moderation.severe_categories.unknown_name", { name });
    }
  }
  return severe.size > 0 ? severe : new Set(DEFAULT_SEVERE_CATEGORIES);
}

@Injectable()
export class ModerationService implements IModerationService {
  private readonly logger: Logger;
  private readonly severeCategories: Set<string>;
  private openAiClient?: OpenAI;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: ModerationService.name });
    this.severeCategories = parseSevereCategories(
      process.env.MODERATION_SEVERE_CATEGORIES ?? "",
      this.logger,
    );
  }

  /**
   * Lazy so a missing OPENAI_API_KEY fails open per-call instead of
   * crashing module init in environments without a key.
   */
  private getClient(): OpenAI {
    this.openAiClient ??= new OpenAI();
    return this.openAiClient;
  }

  async assessContent(
    content: string,
    imageUrls?: string[],
  ): Promise<ModerationVerdict> {
    const allow: ModerationVerdict = {
      action: "allow",
      flaggedCategories: [],
      severeCategories: [],
    };

    const hasText = !!content;
    const images = imageUrls ?? [];
    const hasImages = images.length > 0;
    if (!hasText && !hasImages) return allow;

    // Text and images are sent as two independent moderations.create calls
    // rather than one combined call. A single call means OpenAI failing to
    // fetch an image URL errors the WHOLE call, and the catch's fail-open
    // would downgrade an already-computed severe TEXT verdict to allow too.
    // Splitting scopes each call's failure to only its own input class.
    // Single-input callers (text-only or image-only) still make one call.
    const flaggedByClass: string[][] = [];
    if (hasText) {
      flaggedByClass.push(
        await this.runModeration([{ type: "text", text: content }], "text"),
      );
    }
    if (hasImages) {
      flaggedByClass.push(
        await this.runModeration(
          images.map(
            (url): OpenAI.ModerationMultiModalInput => ({
              type: "image_url",
              image_url: { url },
            }),
          ),
          "image",
        ),
      );
    }

    const flagged = new Set<string>();
    for (const categories of flaggedByClass) {
      for (const category of categories) flagged.add(category);
    }
    const flaggedCategories = [...flagged].sort();
    const severeCategories = flaggedCategories.filter((category) =>
      this.severeCategories.has(category),
    );

    logAiInvocation(this.logger, {
      modelKey: MODERATION_MODEL_KEY,
      purpose: "moderation",
      prompt: content,
      response: JSON.stringify(flaggedCategories),
    });

    if (severeCategories.length > 0) {
      return { action: "block_severe", flaggedCategories, severeCategories };
    }
    if (flaggedCategories.length > 0) {
      return {
        action: "allow_with_log",
        flaggedCategories,
        severeCategories: [],
      };
    }
    return allow;
  }

  /**
   * Runs a single moderations.create call for one input class (text or
   * images) and fails open ONLY for that class's content on error. Scoped
   * so a failure here (e.g. an unfetchable image URL) can never downgrade a
   * verdict already computed from the other class's call.
   */
  private async runModeration(
    input: OpenAI.ModerationMultiModalInput[],
    inputClass: "text" | "image",
  ): Promise<string[]> {
    try {
      const response = await this.getClient().moderations.create({
        model: MODERATION_MODEL,
        input,
      });
      const flagged = new Set<string>();
      for (const result of response.results) {
        for (const [category, isFlagged] of Object.entries(result.categories)) {
          if (isFlagged) flagged.add(category);
        }
      }
      return [...flagged];
    } catch (error) {
      this.logger.error(
        `Error validating content (${inputClass}): ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return [];
    }
  }

  async validateContent(content: string): Promise<boolean> {
    const verdict = await this.assessContent(content);
    if (verdict.action === "allow_with_log") {
      this.logger.warn("authoring.moderation.flagged", {
        categories: verdict.flaggedCategories,
      });
    }
    return verdict.action !== "block_severe";
  }

  sanitizeContent(content: string): string {
    if (!content) return "";

    try {
      return sanitize(content);
    } catch (error) {
      this.logger.error(
        `Error sanitizing content: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return content;
    }
  }
}
