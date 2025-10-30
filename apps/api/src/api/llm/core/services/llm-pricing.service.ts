/* eslint-disable */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PricingSource } from "@prisma/client";
import * as cheerio from "cheerio";
import { PrismaService } from "../../../../database/prisma.service";
import { LLM_RESOLVER_SERVICE } from "../../llm.constants";
import { LLMResolverService } from "./llm-resolver.service";

export interface ModelPricing {
  modelKey: string;
  inputTokenPrice: number;
  outputTokenPrice: number;
  effectiveDate: Date;
  source: PricingSource;
  metadata?: any;
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  modelKey: string;
  pricingEffectiveDate: Date;
  inputTokenPrice: number;
  outputTokenPrice: number;
}

const OPENAI_PRICING_URL = "https://openai.com/api/pricing";

type ExtractResult = {
  modelKey: string;
  inputPerToken: number;
  outputPerToken: number;
  sourceUrl: string;
  fetchedAt: string;
  lastModified?: string | null;
};

/**
 * Helper functions for parsing pricing data
 */
function dollarsPerTokenFromPerMillion(perMillionUSD: number): number {
  return perMillionUSD / 1_000_000;
}

/**
 * Strategy 1: Extract from structured data (JSON-LD, data attributes, etc.)
 */
async function extractFromStructuredData(
  $: cheerio.CheerioAPI,
  logger: Logger,
): Promise<ExtractResult[]> {
  const results: ExtractResult[] = [];

  try {
    const jsonLdScripts = $('script[type="application/ld+json"]');
    jsonLdScripts.each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).text());
        if (jsonData && jsonData.offers && Array.isArray(jsonData.offers)) {
          jsonData.offers.forEach((offer: any) => {
            if (offer.name && offer.price) {
              const modelKey = normalizeModelName(offer.name);
              if (modelKey && offer.inputPrice && offer.outputPrice) {
                results.push({
                  modelKey,
                  inputPerToken: offer.inputPrice,
                  outputPerToken: offer.outputPrice,
                  sourceUrl: OPENAI_PRICING_URL,
                  fetchedAt: new Date().toISOString(),
                });
              }
            }
          });
        }
      } catch {}
    });

    const pricingElements = $(
      "[data-model-name], [data-pricing], .pricing-card, .model-card",
    );
    pricingElements.each((i, elem) => {
      const $elem = $(elem);
      const modelName =
        $elem.attr("data-model-name") ||
        $elem.find("[data-model-name]").attr("data-model-name");
      const inputPrice =
        $elem.attr("data-input-price") ||
        $elem.find("[data-input-price]").attr("data-input-price");
      const outputPrice =
        $elem.attr("data-output-price") ||
        $elem.find("[data-output-price]").attr("data-output-price");

      if (modelName && inputPrice && outputPrice) {
        const modelKey = normalizeModelName(modelName);
        if (modelKey) {
          results.push({
            modelKey,
            inputPerToken: Number.parseFloat(inputPrice),
            outputPerToken: Number.parseFloat(outputPrice),
            sourceUrl: OPENAI_PRICING_URL,
            fetchedAt: new Date().toISOString(),
          });
        }
      }
    });

    logger.log(`Structured data extraction found ${results.length} models`);
    return results;
  } catch (error) {
    logger.warn("Structured data extraction failed:", error);
    return [];
  }
}

/**
 * Strategy 2: Extract from pricing tables or card layouts
 */
async function extractFromPricingTables(
  $: cheerio.CheerioAPI,
  logger: Logger,
): Promise<ExtractResult[]> {
  const results: ExtractResult[] = [];

  try {
    const tables = $("table, .pricing-table, .model-grid, .pricing-grid");
    tables.each((i, table) => {
      const $table = $(table);

      const rows = $table.find("tr, .pricing-card, .model-card, .pricing-row");
      rows.each((j, row) => {
        const $row = $(row);
        const text = $row.text().toLowerCase();

        const modelKey = detectModelFromText(text);
        if (modelKey) {
          const prices = extractPricesFromElement($row);
          if (prices.input && prices.output) {
            results.push({
              modelKey,
              inputPerToken: prices.input,
              outputPerToken: prices.output,
              sourceUrl: OPENAI_PRICING_URL,
              fetchedAt: new Date().toISOString(),
            });
          }
        }
      });
    });

    const cards = $(
      '.card, .pricing-card, .model-card, [class*="pricing"], [class*="model"]',
    );
    cards.each((i, card) => {
      const $card = $(card);
      const text = $card.text().toLowerCase();

      const modelKey = detectModelFromText(text);
      if (modelKey) {
        const prices = extractPricesFromElement($card);
        if (prices.input && prices.output) {
          results.push({
            modelKey,
            inputPerToken: prices.input,
            outputPerToken: prices.output,
            sourceUrl: OPENAI_PRICING_URL,
            fetchedAt: new Date().toISOString(),
          });
        }
      }
    });

    logger.log(`Table/card extraction found ${results.length} models`);
    return results;
  } catch (error) {
    logger.warn("Table/card extraction failed:", error);
    return [];
  }
}

/**
 * Strategy 3: Enhanced text pattern matching with multiple patterns
 */
async function extractFromTextPatterns(
  $: cheerio.CheerioAPI,
  logger: Logger,
): Promise<ExtractResult[]> {
  const results: ExtractResult[] = [];

  try {
    const bodyText = $("body").text();

    const patterns = [
      {
        regex:
          /gpt-?5(?:\s+|-)?(mini|nano)?\s*[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,

        baseModel: "gpt-5",
      },
      {
        regex:
          /gpt-?4o(?:\s+|-)?(mini)?\s*[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,

        baseModel: "gpt-4o",
      },
      {
        regex:
          /(?:^|[^a-z])gpt.?4o(?:\s|\$|[^a-z-])[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,

        baseModel: "gpt-4o",
      },
      {
        regex:
          /gpt-?4\.1(?:\s+|-)?(mini|nano)?\s*[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,

        baseModel: "gpt-4.1",
      },
      {
        regex:
          /o([1-4])(?:\s+|-)?(pro|mini|deep-research)?\s*[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,

        baseModel: "o",
      },
      {
        regex: /textgpt-4o[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,
        baseModel: "gpt-4o",
      },
      {
        regex: /gpt-4o\s*text[^$]*?\$?([\d.]+)[^$]*?\$?([\d.]+)/gi,
        baseModel: "gpt-4o",
      },
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(bodyText)) !== null) {
        const variant = match[1] || match[2];
        const inputPrice = Number.parseFloat(match.at(-2));
        const outputPrice = Number.parseFloat(match.at(-1));

        if (!isNaN(inputPrice) && !isNaN(outputPrice)) {
          let modelKey = pattern.baseModel;
          if (pattern.baseModel === "o") {
            modelKey = `o${match[1]}`;
            if (variant && variant !== match[1]) {
              modelKey += `-${variant}`;
            }
          } else if (variant) {
            modelKey += `-${variant}`;
          }

          results.push({
            modelKey: modelKey.toLowerCase(),
            inputPerToken: dollarsPerTokenFromPerMillion(inputPrice),
            outputPerToken: dollarsPerTokenFromPerMillion(outputPrice),
            sourceUrl: OPENAI_PRICING_URL,
            fetchedAt: new Date().toISOString(),
          });
        }
      }
    }

    logger.log(`Text pattern extraction found ${results.length} models`);
    return results;
  } catch (error) {
    logger.warn("Text pattern extraction failed:", error);
    return [];
  }
}

/**
 * Normalize model names to match our internal naming convention
 */
function normalizeModelName(name: string): string | null {
  const normalized = name.toLowerCase().replaceAll(/[^\d.a-z-]/g, "");

  const modelMap: Record<string, string> = {
    gpt5: "gpt-5",
    gpt5mini: "gpt-5-mini",
    gpt5nano: "gpt-5-nano",
    gpt4o: "gpt-4o",
    gpt4omini: "gpt-4o-mini",
    gpt41mini: "gpt-4.1-mini",
    gpt41nano: "gpt-4.1-nano",
    o1pro: "o1-pro",
    o1mini: "o1-mini",
    o3pro: "o3-pro",
    o3mini: "o3-mini",
    o3deepresearch: "o3-deep-research",
    o4mini: "o4-mini",
    o4minideepresearch: "o4-mini-deep-research",
  };

  return modelMap[normalized] || normalized;
}

/**
 * Detect model name from text content
 */
function detectModelFromText(text: string): string | null {
  const lowerText = text.toLowerCase();

  if (lowerText.includes("gpt-5") && lowerText.includes("nano"))
    return "gpt-5-nano";
  if (lowerText.includes("gpt-5") && lowerText.includes("mini"))
    return "gpt-5-mini";
  if (lowerText.includes("gpt-5")) return "gpt-5";

  if (lowerText.includes("gpt-4o") && lowerText.includes("mini"))
    return "gpt-4o-mini";
  if (lowerText.match(/gpt-?4o(?!\w)/)) return "gpt-4o";
  if (lowerText.includes("gpt4o")) return "gpt-4o";

  if (lowerText.includes("gpt-4.1") && lowerText.includes("mini"))
    return "gpt-4.1-mini";
  if (lowerText.includes("gpt-4.1") && lowerText.includes("nano"))
    return "gpt-4.1-nano";
  if (lowerText.includes("gpt-4.1")) return "gpt-4.1";

  if (
    lowerText.includes("o1-pro") ||
    (lowerText.includes("o1") && lowerText.includes("pro"))
  )
    return "o1-pro";
  if (
    lowerText.includes("o1-mini") ||
    (lowerText.includes("o1") && lowerText.includes("mini"))
  )
    return "o1-mini";
  if (lowerText.includes("o1")) return "o1";

  if (
    lowerText.includes("o3-pro") ||
    (lowerText.includes("o3") && lowerText.includes("pro"))
  )
    return "o3-pro";
  if (
    lowerText.includes("o3-mini") ||
    (lowerText.includes("o3") && lowerText.includes("mini"))
  )
    return "o3-mini";
  if (
    lowerText.includes("o3-deep-research") ||
    (lowerText.includes("o3") && lowerText.includes("deep"))
  )
    return "o3-deep-research";
  if (lowerText.includes("o3")) return "o3";

  if (lowerText.includes("o4-mini-deep-research"))
    return "o4-mini-deep-research";
  if (
    lowerText.includes("o4-mini") ||
    (lowerText.includes("o4") && lowerText.includes("mini"))
  )
    return "o4-mini";

  return null;
}

/**
 * Extract pricing numbers from a DOM element
 */
function extractPricesFromElement($elem: any): {
  input?: number;
  output?: number;
} {
  const text = $elem.text();

  const patterns = [
    /input[\s:]*\$?([\d.]+)[^$]*output[\s:]*\$?([\d.]+)/gi,
    /\$?([\d.]+)[^$]*input[^$]*\$?([\d.]+)[^$]*output/gi,
    /\$?([\d.]+)[^$]*\/[^$]*\$?([\d.]+)/gi,
    /per\s+million.*?\$?([\d.]+)[^$]*\$?([\d.]+)/gi,
    /\$?([\d.]+)[^$\d]{0,20}\$?([\d.]+)(?:\s|$)/gi,
    /(?:^|\s)\$?([\d.]+)[^$]*?(?:per|\/)[^$]*?\$?([\d.]+)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const price1 = Number.parseFloat(match[1]);
      const price2 = Number.parseFloat(match[2]);

      if (!isNaN(price1) && !isNaN(price2)) {
        return {
          input: dollarsPerTokenFromPerMillion(price1),
          output: dollarsPerTokenFromPerMillion(price2),
        };
      }
    }
  }

  return {};
}

/**
 * Strategy 4: Aggressive pattern matching for commonly missed models like gpt-4o
 */
async function extractWithAggressivePatterns(
  $: cheerio.CheerioAPI,
  logger: Logger,
): Promise<ExtractResult[]> {
  const results: ExtractResult[] = [];

  try {
    const bodyText = $("body").text();
    const cleanedText = bodyText.replace(/\s+/g, " ").toLowerCase();

    const aggressivePatterns = [
      /gpt[-\s]?4o[^a-z][^$]*?\$?([\d.]+)[^$\d]{1,50}\$?([\d.]+)/gi,
      /text[^$]*?gpt[-\s]?4o[^$]*?\$?([\d.]+)[^$\d]{1,50}\$?([\d.]+)/gi,
      /gpt[-\s]?4o[^$]{0,100}([\d.]+)[^$\d]{1,50}([\d.]+)/gi,
      /4o[^$\d]{0,80}([\d.]+)[^$\d]{1,50}([\d.]+)/gi,
    ];

    for (const pattern of aggressivePatterns) {
      let match;
      while ((match = pattern.exec(cleanedText)) !== null) {
        const price1 = parseFloat(match[1]);
        const price2 = parseFloat(match[2]);

        if (!isNaN(price1) && !isNaN(price2) && price1 > 0 && price2 > 0) {
          const inputPrice = price1 < price2 ? price1 : price2;
          const outputPrice = price1 < price2 ? price2 : price1;

          if (
            inputPrice >= 0.1 &&
            inputPrice <= 50 &&
            outputPrice >= 0.1 &&
            outputPrice <= 200
          ) {
            results.push({
              modelKey: "gpt-4o",
              inputPerToken: dollarsPerTokenFromPerMillion(inputPrice),
              outputPerToken: dollarsPerTokenFromPerMillion(outputPrice),
              sourceUrl: OPENAI_PRICING_URL,
              fetchedAt: new Date().toISOString(),
            });

            logger.log(
              `Aggressive pattern found gpt-4o: $${inputPrice}/$${outputPrice} per million`,
            );
            break;
          }
        }
      }

      if (results.length > 0) {
        const miniPatterns = [
          /gpt[-\s]?4o[-\s]?mini[^$]*?\$?([\d.]+)[^$\d]{1,50}\$?([\d.]+)/gi,
          /4o[-\s]?mini[^$]{0,80}([\d.]+)[^$\d]{1,50}([\d.]+)/gi,
        ];

        for (const miniPattern of miniPatterns) {
          const miniMatch = miniPattern.exec(cleanedText);
          if (miniMatch) {
            const miniPrice1 = parseFloat(miniMatch[1]);
            const miniPrice2 = parseFloat(miniMatch[2]);

            if (
              !isNaN(miniPrice1) &&
              !isNaN(miniPrice2) &&
              miniPrice1 > 0 &&
              miniPrice2 > 0
            ) {
              const inputPrice =
                miniPrice1 < miniPrice2 ? miniPrice1 : miniPrice2;
              const outputPrice =
                miniPrice1 < miniPrice2 ? miniPrice2 : miniPrice1;

              if (
                inputPrice >= 0.01 &&
                inputPrice <= 5 &&
                outputPrice >= 0.01 &&
                outputPrice <= 20
              ) {
                results.push({
                  modelKey: "gpt-4o-mini",
                  inputPerToken: dollarsPerTokenFromPerMillion(inputPrice),
                  outputPerToken: dollarsPerTokenFromPerMillion(outputPrice),
                  sourceUrl: OPENAI_PRICING_URL,
                  fetchedAt: new Date().toISOString(),
                });

                logger.log(
                  `Aggressive pattern found gpt-4o-mini: $${inputPrice}/$${outputPrice} per million`,
                );
                break;
              }
            }
          }
        }
        break;
      }
    }

    logger.log(`Aggressive patterns found ${results.length} models`);
    return results;
  } catch (error) {
    logger.warn("Aggressive pattern extraction failed:", error);
    return [];
  }
}

/**
 * Parse pricing from OpenAI pricing page using multiple strategies for better reliability.
 * Attempts structured data extraction first, falls back to text parsing if needed.
 */
async function scrapeAllPricingFromOpenAI(): Promise<ExtractResult[]> {
  const logger = new Logger("LLMPricingScraper");

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];

  const randomUserAgent =
    userAgents[Math.floor(Math.random() * userAgents.length)];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(OPENAI_PRICING_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": randomUserAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger.warn(
        `OpenAI pricing page returned status ${res.status}: ${res.statusText}`,
      );
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let results: ExtractResult[] = [];

    results = await extractFromStructuredData($, logger);
    if (results.length > 0) {
      logger.log(
        `Successfully extracted ${results.length} models from structured data`,
      );
      return results;
    }

    results = await extractFromPricingTables($, logger);
    if (results.length > 0) {
      logger.log(
        `Successfully extracted ${results.length} models from pricing tables`,
      );
      return results;
    }

    results = await extractFromTextPatterns($, logger);
    if (results.length > 0) {
      logger.log(
        `Successfully extracted ${results.length} models from text patterns`,
      );
      return results;
    }

    results = await extractWithAggressivePatterns($, logger);
    if (results.length > 0) {
      logger.log(
        `Successfully extracted ${results.length} models using aggressive patterns`,
      );
      return results;
    }

    logger.warn("All extraction strategies failed, no pricing data found");
    return [];
  } catch (error) {
    logger.error("Error scraping OpenAI pricing:", error);
    return [];
  }
}

/**
 * Single entry point for web scraping a model's pricing with retry logic.
 */
async function resolveOneModelFromWeb(
  modelKey: string,
): Promise<ExtractResult | null> {
  const logger = new Logger("LLMPricingScraper");
  const maxRetries = 3;
  const baseDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(
        `Attempting to scrape pricing for ${modelKey} (attempt ${attempt}/${maxRetries})`,
      );
      const allPricing = await scrapeAllPricingFromOpenAI();
      const result = allPricing.find((p) => p.modelKey === modelKey) || null;

      if (result) {
        logger.log(`Successfully found pricing for ${modelKey}`);
        return result;
      }

      if (attempt < maxRetries) {
        const delay =
          baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        logger.warn(
          `Model ${modelKey} not found in scraped data, retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      logger.error(
        `Error scraping pricing for ${modelKey} (attempt ${attempt}):`,
        error,
      );

      if (attempt < maxRetries) {
        const delay =
          baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.warn(
    `Failed to scrape pricing for ${modelKey} after ${maxRetries} attempts`,
  );
  return null;
}

@Injectable()
export class LLMPricingService {
  private readonly logger = new Logger(LLMPricingService.name);
  private pricingCache: Map<
    string,
    { data: ExtractResult[]; timestamp: number }
  > = new Map();
  private readonly CACHE_TTL = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolverService: LLMResolverService,
  ) {}

  /**
   * Get cached pricing data or fetch fresh data if cache is expired
   */
  private async getCachedPricingData(): Promise<ExtractResult[]> {
    const cacheKey = "openai_pricing";
    const cached = this.pricingCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.log("Using cached pricing data");
      return cached.data;
    }

    this.logger.log("Fetching fresh pricing data from OpenAI");
    const freshData = await scrapeAllPricingFromOpenAI();

    this.pricingCache.set(cacheKey, {
      data: freshData,
      timestamp: Date.now(),
    });

    return freshData;
  }

  /**
   * Fetches current pricing from OpenAI website using web scraping
   * Gets all OpenAI models from database and attempts to fetch their current pricing
   */
  async fetchCurrentPricing(): Promise<ModelPricing[]> {
    this.logger.log(
      "Fetching current pricing from OpenAI website via web scraping",
    );

    try {
      const openaiModels = await this.prisma.lLMModel.findMany({
        where: {
          provider: "OpenAI",
          isActive: true,
        },
      });

      this.logger.log(
        `Found ${openaiModels.length} OpenAI models to fetch pricing for`,
      );

      const scrapedPricing = await this.getCachedPricingData();

      if (scrapedPricing.length === 0) {
        this.logger.warn(
          "No pricing data scraped, falling back to manual pricing",
        );
        return this.getFallbackPricingForAllModels();
      }

      const currentPricing: ModelPricing[] = [];
      const modelsWithPricing: Set<string> = new Set();

      for (const model of openaiModels) {
        const scrapedModel = scrapedPricing.find(
          (p) => p.modelKey === model.modelKey,
        );

        if (scrapedModel) {
          currentPricing.push({
            modelKey: scrapedModel.modelKey,
            inputTokenPrice: scrapedModel.inputPerToken,
            outputTokenPrice: scrapedModel.outputPerToken,
            effectiveDate: new Date(),
            source: PricingSource.WEB_SCRAPING,
            metadata: {
              sourceUrl: scrapedModel.sourceUrl,
              fetchedAt: scrapedModel.fetchedAt,
              lastModified: scrapedModel.lastModified,
            },
          });

          modelsWithPricing.add(model.modelKey);
          this.logger.log(
            `Successfully fetched pricing for ${model.modelKey}: input=$${scrapedModel.inputPerToken}, output=$${scrapedModel.outputPerToken}`,
          );
        } else {
          const fallbackPricing = this.getFallbackPricing(model.modelKey);
          if (fallbackPricing) {
            currentPricing.push(fallbackPricing);
            this.logger.warn(
              `Using fallback pricing for ${model.modelKey} (not available on OpenAI website yet)`,
            );
          } else {
            this.logger.error(`No pricing found for model ${model.modelKey}`);
          }
        }
      }

      this.logger.log(
        `Successfully processed pricing for ${currentPricing.length} models (${
          modelsWithPricing.size
        } from scraping, ${
          currentPricing.length - modelsWithPricing.size
        } from fallback)`,
      );
      return currentPricing;
    } catch (error) {
      this.logger.error("Failed to fetch current pricing:", error);

      const fallbackPricing = this.getFallbackPricingForAllModels();
      this.logger.warn(
        `Returning fallback pricing for ${fallbackPricing.length} models due to scraping failure`,
      );
      return fallbackPricing;
    }
  }

  /**
   * Get fallback pricing for a specific model when web scraping fails
   * Pricing based on OpenAI Standard tier as of Jan 2025
   */
  private getFallbackPricing(modelKey: string): ModelPricing | null {
    const fallbackPrices: Record<string, { input: number; output: number }> = {
      "gpt-4o": { input: 0.000_002_5, output: 0.000_01 },
      "gpt-4o-mini": { input: 0.000_000_15, output: 0.000_000_6 },

      "gpt-4.1": { input: 0.000_002, output: 0.000_008 },
      "gpt-4.1-mini": { input: 0.000_000_4, output: 0.000_001_6 },
      "gpt-4.1-nano": { input: 0.000_000_1, output: 0.000_000_4 },

      "gpt-5": { input: 0.000_001_25, output: 0.000_01 },
      "gpt-5-mini": { input: 0.000_000_25, output: 0.000_002 },
      "gpt-5-nano": { input: 0.000_000_05, output: 0.000_000_4 },

      o1: { input: 0.000_015, output: 0.000_06 },
      "o1-pro": { input: 0.000_15, output: 0.0006 },
      "o1-mini": { input: 0.000_001_1, output: 0.000_004_4 },

      o3: { input: 0.000_002, output: 0.000_008 },
      "o3-pro": { input: 0.000_02, output: 0.000_08 },
      "o3-mini": { input: 0.000_001_1, output: 0.000_004_4 },
      "o3-deep-research": { input: 0.000_01, output: 0.000_04 },

      "o4-mini": { input: 0.000_001_1, output: 0.000_004_4 },
      "o4-mini-deep-research": { input: 0.000_002, output: 0.000_008 },
    };

    const pricing = fallbackPrices[modelKey];
    if (!pricing) return null;

    return {
      modelKey,
      inputTokenPrice: pricing.input,
      outputTokenPrice: pricing.output,
      effectiveDate: new Date(),
      source: PricingSource.MANUAL,
      metadata: {
        lastUpdated: new Date().toISOString(),
        source: "Fallback pricing",
        notes: modelKey.startsWith("gpt-5")
          ? "Estimated pricing for unreleased model"
          : "Known pricing when web scraping failed",
      },
    };
  }

  /**
   * Get fallback pricing for all known models when web scraping completely fails
   */
  private getFallbackPricingForAllModels(): ModelPricing[] {
    const modelKeys = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "o1",
      "o1-pro",
      "o1-mini",
      "o3",
      "o3-pro",
      "o3-mini",
      "o3-deep-research",
      "o4-mini",
      "o4-mini-deep-research",
    ];
    return modelKeys
      .map((modelKey) => this.getFallbackPricing(modelKey))
      .filter((pricing): pricing is ModelPricing => pricing !== null);
  }

  /**
   * Updates pricing history in the database
   */
  async updatePricingHistory(pricingData: ModelPricing[]): Promise<number> {
    let updatedCount = 0;

    for (const pricing of pricingData) {
      try {
        const model = await this.prisma.lLMModel.findUnique({
          where: { modelKey: pricing.modelKey },
        });

        if (!model) {
          this.logger.warn(`Model ${pricing.modelKey} not found in database`);
          continue;
        }

        const existingPricing = await this.prisma.lLMPricing.findFirst({
          where: {
            modelId: model.id,
            inputTokenPrice: pricing.inputTokenPrice,
            outputTokenPrice: pricing.outputTokenPrice,
            source: pricing.source,
            effectiveDate: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });

        if (existingPricing) {
          this.logger.debug(
            `Pricing for ${pricing.modelKey} unchanged within last 24h`,
          );
          continue;
        }

        await this.prisma.lLMPricing.updateMany({
          where: {
            modelId: model.id,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        await this.prisma.lLMPricing.create({
          data: {
            modelId: model.id,
            inputTokenPrice: pricing.inputTokenPrice,
            outputTokenPrice: pricing.outputTokenPrice,
            effectiveDate: pricing.effectiveDate,
            source: pricing.source,
            isActive: true,
            metadata: pricing.metadata,
          },
        });

        this.logger.log(
          `Updated pricing for ${pricing.modelKey}: input=$${pricing.inputTokenPrice}, output=$${pricing.outputTokenPrice}`,
        );
        updatedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to update pricing for ${pricing.modelKey}:`,
          error,
        );
      }
    }

    return updatedCount;
  }

  /**
   * Gets pricing for a specific model at a specific date
   * Falls back to closest available pricing if no exact match found
   */
  async getPricingAtDate(
    modelKey: string,
    date: Date,
  ): Promise<ModelPricing | null> {
    const model = await this.prisma.lLMModel.findUnique({
      where: { modelKey },
    });

    if (!model) {
      this.logger.warn(`Model ${modelKey} not found`);
      return null;
    }

    let pricing = await this.prisma.lLMPricing.findFirst({
      where: {
        modelId: model.id,
        effectiveDate: {
          lte: date,
        },
      },
      orderBy: {
        effectiveDate: "desc",
      },
      include: {
        model: true,
      },
    });

    if (!pricing) {
      pricing = await this.prisma.lLMPricing.findFirst({
        where: {
          modelId: model.id,
          effectiveDate: {
            gt: date,
          },
        },
        orderBy: {
          effectiveDate: "asc",
        },
        include: {
          model: true,
        },
      });

      if (pricing) {
        this.logger.debug(
          `Using future pricing for ${modelKey} at ${date.toISOString()}: effective ${pricing.effectiveDate.toISOString()}`,
        );
      }
    }

    if (!pricing) {
      pricing = await this.prisma.lLMPricing.findFirst({
        where: {
          modelId: model.id,
        },
        orderBy: {
          effectiveDate: "desc",
        },
        include: {
          model: true,
        },
      });

      if (pricing) {
        this.logger.debug(
          `Using latest available pricing for ${modelKey} at ${date.toISOString()}: effective ${pricing.effectiveDate.toISOString()}`,
        );
      }
    }

    if (!pricing) {
      this.logger.warn(`No pricing found for ${modelKey} at any date`);
      return null;
    }

    return {
      modelKey: pricing.model.modelKey,
      inputTokenPrice: pricing.inputTokenPrice,
      outputTokenPrice: pricing.outputTokenPrice,
      effectiveDate: pricing.effectiveDate,
      source: pricing.source,
      metadata: pricing.metadata,
    };
  }

  /**
   * Gets current active pricing for a model
   */
  async getCurrentPricing(modelKey: string): Promise<ModelPricing | null> {
    const model = await this.prisma.lLMModel.findUnique({
      where: { modelKey },
    });

    if (!model) {
      return null;
    }

    const pricing = await this.prisma.lLMPricing.findFirst({
      where: {
        modelId: model.id,
        isActive: true,
      },
      include: {
        model: true,
      },
    });

    if (!pricing) {
      return null;
    }

    return {
      modelKey: pricing.model.modelKey,
      inputTokenPrice: pricing.inputTokenPrice,
      outputTokenPrice: pricing.outputTokenPrice,
      effectiveDate: pricing.effectiveDate,
      source: pricing.source,
      metadata: pricing.metadata,
    };
  }

  /**
   * Calculate cost with detailed breakdown using historical pricing and current upscaling
   */
  async calculateCostWithBreakdown(
    modelKey: string,
    inputTokens: number,
    outputTokens: number,
    usageDate: Date,
    usageType?: string,
  ): Promise<CostBreakdown | null> {
    return await this.calculateCostWithUpscaling(
      modelKey,
      inputTokens,
      outputTokens,
      usageDate,
      usageType,
    );
  }

  /**
   * Get all supported models
   */
  async getSupportedModels() {
    return await this.prisma.lLMModel.findMany({
      where: { isActive: true },
      include: {
        pricingHistory: {
          where: { isActive: true },
          orderBy: { effectiveDate: "desc" },
          take: 1,
        },
      },
    });
  }

  /**
   * Get pricing history for a model
   */
  async getPricingHistory(modelKey: string, limit = 10) {
    const model = await this.prisma.lLMModel.findUnique({
      where: { modelKey },
    });

    if (!model) {
      return [];
    }

    return await this.prisma.lLMPricing.findMany({
      where: { modelId: model.id },
      orderBy: { effectiveDate: "desc" },
      take: limit,
      include: { model: true },
    });
  }

  /**
   * Get pricing statistics
   */
  async getPricingStatistics() {
    const models = await this.prisma.lLMModel.count();
    const activePricing = await this.prisma.lLMPricing.count({
      where: { isActive: true },
    });
    const totalPricingRecords = await this.prisma.lLMPricing.count();

    const lastUpdate = await this.prisma.lLMPricing.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    return {
      totalModels: models,
      activePricingRecords: activePricing,
      totalPricingRecords,
      lastUpdated: lastUpdate?.createdAt,
    };
  }

  /**
   * Apply price upscaling factors - stores scaling factors in dedicated table
   */
  async applyPriceUpscaling(
    globalFactor?: number,
    usageFactors?: { [usageType: string]: number },
    reason?: string,
    appliedBy?: string,
  ): Promise<{
    updatedModels: number;
    oldUpscaling: any;
    newUpscaling: any;
    effectiveDate: Date;
  }> {
    const effectiveDate = new Date();

    this.logger.log(
      `Applying price upscaling: globalFactor=${globalFactor}, usageFactors=${JSON.stringify(
        usageFactors,
      )}, reason=${reason}`,
    );

    try {
      const oldUpscaling = await this.prisma.lLMPriceUpscaling.findFirst({
        where: { isActive: true },
      });

      if (oldUpscaling) {
        await this.prisma.lLMPriceUpscaling.update({
          where: { id: oldUpscaling.id },
          data: {
            isActive: false,
            deactivatedAt: effectiveDate,
          },
        });
      }

      const newUpscaling = await this.prisma.lLMPriceUpscaling.create({
        data: {
          globalFactor: globalFactor || null,
          usageTypeFactors: usageFactors ? JSON.stringify(usageFactors) : null,
          reason: reason || "Manual price upscaling via admin interface",
          appliedBy: appliedBy || "admin",
          isActive: true,
          effectiveDate: effectiveDate,
        },
      });

      await this.clearPricingCache();

      const modelsCount = await this.prisma.lLMModel.count({
        where: { isActive: true },
      });

      this.logger.log(
        `Price upscaling applied successfully. Will affect ${modelsCount} models.`,
      );

      return {
        updatedModels: modelsCount,
        oldUpscaling: oldUpscaling || null,
        newUpscaling: {
          id: newUpscaling.id,
          globalFactor: newUpscaling.globalFactor,
          usageTypeFactors: newUpscaling.usageTypeFactors,
          reason: newUpscaling.reason,
          appliedBy: newUpscaling.appliedBy,
          effectiveDate: newUpscaling.effectiveDate,
        },
        effectiveDate,
      };
    } catch (error) {
      this.logger.error("Failed to apply price upscaling:", error);
      throw error;
    }
  }

  /**
   * Get current active price upscaling factors
   */
  async getCurrentPriceUpscaling() {
    return await this.prisma.lLMPriceUpscaling.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: "desc" },
    });
  }

  /**
   * Remove current price upscaling (revert to base pricing)
   */
  async removePriceUpscaling(
    reason?: string,
    removedBy?: string,
  ): Promise<boolean> {
    try {
      const activeUpscaling = await this.prisma.lLMPriceUpscaling.findFirst({
        where: { isActive: true },
      });

      if (!activeUpscaling) {
        this.logger.log("No active price upscaling to remove");
        return false;
      }

      await this.prisma.lLMPriceUpscaling.update({
        where: { id: activeUpscaling.id },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          reason: reason
            ? `${activeUpscaling.reason} | Removed: ${reason}`
            : activeUpscaling.reason,
        },
      });

      await this.clearPricingCache();

      this.logger.log(`Price upscaling removed by ${removedBy || "admin"}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to remove price upscaling:", error);
      throw error;
    }
  }

  /**
   * Calculate cost with upscaling factors applied
   */
  async calculateCostWithUpscaling(
    modelKey: string,
    inputTokens: number,
    outputTokens: number,
    usageDate: Date,
    usageType?: string,
  ): Promise<CostBreakdown | null> {
    const basePricing = await this.getPricingAtDate(modelKey, usageDate);
    if (!basePricing) {
      return null;
    }

    const upscaling = await this.getCurrentPriceUpscaling();

    let finalInputPrice = basePricing.inputTokenPrice;
    let finalOutputPrice = basePricing.outputTokenPrice;

    if (upscaling) {
      if (upscaling.globalFactor && upscaling.globalFactor > 0) {
        finalInputPrice *= upscaling.globalFactor;
        finalOutputPrice *= upscaling.globalFactor;
      }

      if (usageType && upscaling.usageTypeFactors) {
        try {
          const usageFactors = JSON.parse(upscaling.usageTypeFactors as string);
          const usageFactor = usageFactors[usageType];
          if (usageFactor && usageFactor > 0) {
            finalInputPrice *= usageFactor;
            finalOutputPrice *= usageFactor;
          }
        } catch (error) {
          this.logger.warn("Failed to parse usage type factors:", error);
        }
      }
    }

    const inputCost = inputTokens * finalInputPrice;
    const outputCost = outputTokens * finalOutputPrice;
    const totalCost = inputCost + outputCost;

    return {
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost,
      modelKey,
      pricingEffectiveDate: basePricing.effectiveDate,
      inputTokenPrice: finalInputPrice,
      outputTokenPrice: finalOutputPrice,
    };
  }

  /**
   * Clear pricing cache and related model assignment cache
   */
  private clearPricingCache(): void {
    try {
      this.llmResolverService.clearAllCache();

      this.logger.log("Pricing cache and model assignment cache cleared");
    } catch (error) {
      this.logger.warn("Failed to clear some caches:", error);
    }
  }

  /**
   * Clear only the web scraping cache (useful for testing or forced refresh)
   */
  clearWebScrapingCache(): void {
    this.pricingCache.clear();
    this.logger.log("Web scraping cache cleared");
  }

  /**
   * Get cache status and statistics
   */
  getCacheStatus(): {
    hasCachedData: boolean;
    cacheAge: number | null;
    cacheCount: number;
    cacheTTL: number;
  } {
    const cached = this.pricingCache.get("openai_pricing");
    return {
      hasCachedData: !!cached,
      cacheAge: cached ? Date.now() - cached.timestamp : null,
      cacheCount: this.pricingCache.size,
      cacheTTL: this.CACHE_TTL,
    };
  }

  /**
   * Test scraping functionality for a specific model
   */
  async testScrapingForModel(modelKey: string): Promise<{
    success: boolean;
    pricing?: ExtractResult;
    error?: string;
    fallbackUsed?: boolean;
  }> {
    try {
      this.logger.log(`Testing scraping functionality for ${modelKey}`);

      this.pricingCache.delete("openai_pricing");
      const scrapedData = await this.getCachedPricingData();

      const result = scrapedData.find((p) => p.modelKey === modelKey);

      if (result) {
        return { success: true, pricing: result };
      } else {
        const fallback = this.getFallbackPricing(modelKey);
        return fallback
          ? {
              success: true,
              fallbackUsed: true,
              pricing: {
                modelKey: fallback.modelKey,
                inputPerToken: fallback.inputTokenPrice,
                outputPerToken: fallback.outputTokenPrice,
                sourceUrl: "fallback",
                fetchedAt: new Date().toISOString(),
              },
            }
          : {
              success: false,
              error: `Model ${modelKey} not found in scraped data or fallback`,
            };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get comprehensive pricing status for all known models
   */
  async getPricingStatus(): Promise<{
    totalModels: number;
    scrapedSuccessfully: number;
    usingFallback: number;
    notFound: number;
    cacheStatus: any;
    lastUpdate?: Date;
  }> {
    try {
      const models = await this.prisma.lLMModel.findMany({
        where: { provider: "OpenAI", isActive: true },
      });

      const scrapedData = await this.getCachedPricingData();
      const cacheStatus = this.getCacheStatus();

      let scrapedSuccessfully = 0;
      let usingFallback = 0;
      let notFound = 0;

      for (const model of models) {
        const scraped = scrapedData.find((p) => p.modelKey === model.modelKey);
        if (scraped) {
          scrapedSuccessfully++;
        } else {
          const fallback = this.getFallbackPricing(model.modelKey);
          if (fallback) {
            usingFallback++;
          } else {
            notFound++;
          }
        }
      }

      const lastUpdate = await this.prisma.lLMPricing.findFirst({
        orderBy: { effectiveDate: "desc" },
        select: { effectiveDate: true },
      });

      return {
        totalModels: models.length,
        scrapedSuccessfully,
        usingFallback,
        notFound,
        cacheStatus,
        lastUpdate: lastUpdate?.effectiveDate,
      };
    } catch (error) {
      this.logger.error("Error getting pricing status:", error);
      throw error;
    }
  }
}
