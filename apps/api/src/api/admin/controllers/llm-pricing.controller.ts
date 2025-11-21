/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { LLMPricingService } from "../../llm/core/services/llm-pricing.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";

@Controller({
  path: "llm-pricing",
  version: "1",
})
@UseGuards(AdminGuard)
export class LLMPricingController {
  constructor(
    @Inject(LLM_PRICING_SERVICE)
    private readonly llmPricingService: LLMPricingService,
  ) {}

  /**
   * Get current pricing for all supported models
   */
  @Get("current")
  async getCurrentPricing() {
    try {
      const models = await this.llmPricingService.getSupportedModels();
      return {
        success: true,
        data: models.map((model) => ({
          id: model.id,
          modelKey: model.modelKey,
          displayName: model.displayName,
          provider: model.provider,
          isActive: model.isActive,
          currentPricing: model.pricingHistory[0] || null,
        })),
      };
    } catch {
      throw new HttpException(
        "Failed to fetch current pricing",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get pricing history for a specific model
   */
  @Get("history")
  async getPricingHistory(
    @Query("modelKey") modelKey: string,
    @Query("limit") limit?: string,
  ) {
    if (!modelKey) {
      throw new HttpException("modelKey is required", HttpStatus.BAD_REQUEST);
    }

    try {
      const parsedLimit = limit ? Number.parseInt(limit, 10) : 10;
      const history = await this.llmPricingService.getPricingHistory(
        modelKey,
        parsedLimit,
      );

      return {
        success: true,
        data: {
          modelKey,
          history: history.map((pricing) => ({
            id: pricing.id,
            inputTokenPrice: pricing.inputTokenPrice,
            outputTokenPrice: pricing.outputTokenPrice,
            effectiveDate: pricing.effectiveDate,
            source: pricing.source,
            isActive: pricing.isActive,
            createdAt: pricing.createdAt,
            metadata: pricing.metadata,
          })),
        },
      };
    } catch {
      throw new HttpException(
        "Failed to fetch pricing history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get pricing statistics
   */
  @Get("statistics")
  async getPricingStatistics() {
    try {
      const stats = await this.llmPricingService.getPricingStatistics();
      return {
        success: true,
        data: stats,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch pricing statistics",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Manually refresh pricing data from external sources
   */
  @Post("refresh")
  async refreshPricing() {
    try {
      const currentPricing = await this.llmPricingService.fetchCurrentPricing();

      if (currentPricing.length === 0) {
        return {
          success: false,
          message: "No pricing data available from external sources",
          data: { updatedModels: 0 },
        };
      }

      const updatedCount =
        await this.llmPricingService.updatePricingHistory(currentPricing);

      return {
        success: true,
        message: `Successfully updated pricing for ${updatedCount} models`,
        data: {
          updatedModels: updatedCount,
          totalModelsFetched: currentPricing.length,
          lastRefresh: new Date().toISOString(),
        },
      };
    } catch {
      throw new HttpException(
        "Failed to refresh pricing",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get supported models
   */
  @Get("models")
  async getSupportedModels() {
    try {
      const models = await this.llmPricingService.getSupportedModels();
      return {
        success: true,
        data: models,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch supported models",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Calculate cost breakdown for specific usage
   */
  @Get("calculate-cost")
  async calculateCost(
    @Query("modelKey") modelKey: string,
    @Query("inputTokens") inputTokens: string,
    @Query("outputTokens") outputTokens: string,
    @Query("usageDate") usageDate?: string,
  ) {
    if (!modelKey || !inputTokens || !outputTokens) {
      throw new HttpException(
        "modelKey, inputTokens, and outputTokens are required",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const parsedInputTokens = Number.parseInt(inputTokens, 10);
      const parsedOutputTokens = Number.parseInt(outputTokens, 10);
      const parsedUsageDate = usageDate ? new Date(usageDate) : new Date();

      if (Number.isNaN(parsedInputTokens) || Number.isNaN(parsedOutputTokens)) {
        throw new HttpException(
          "inputTokens and outputTokens must be valid numbers",
          HttpStatus.BAD_REQUEST,
        );
      }

      const costBreakdown =
        await this.llmPricingService.calculateCostWithBreakdown(
          modelKey,
          parsedInputTokens,
          parsedOutputTokens,
          parsedUsageDate,
        );

      if (!costBreakdown) {
        throw new HttpException(
          `No pricing data found for model ${modelKey}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: costBreakdown,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to calculate cost",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Apply price upscaling factors to all models
   */
  @Post("upscale")
  async upscalePricing(
    @Body()
    upscaleData: {
      globalFactor?: number;
      usageFactors?: { [usageType: string]: number };
      reason?: string;
    },
  ) {
    if (
      !upscaleData.globalFactor &&
      (!upscaleData.usageFactors ||
        Object.keys(upscaleData.usageFactors).length === 0)
    ) {
      throw new HttpException(
        "Either globalFactor or at least one usage type factor must be provided",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      upscaleData.globalFactor &&
      (upscaleData.globalFactor <= 0 || Number.isNaN(upscaleData.globalFactor))
    ) {
      throw new HttpException(
        "Global factor must be a positive number",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (upscaleData.usageFactors) {
      for (const [usageType, factor] of Object.entries(
        upscaleData.usageFactors,
      )) {
        if (factor <= 0 || Number.isNaN(factor)) {
          throw new HttpException(
            `Usage factor for ${usageType} must be a positive number`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    try {
      const result = await this.llmPricingService.applyPriceUpscaling(
        upscaleData.globalFactor,
        upscaleData.usageFactors || {},
        upscaleData.reason || "Manual price upscaling via admin interface",
        "admin",
      );

      return {
        success: true,
        message: `Successfully upscaled pricing for ${result.updatedModels} models`,
        data: {
          updatedModels: result.updatedModels,
          globalFactor: upscaleData.globalFactor,
          usageFactors: upscaleData.usageFactors,
          oldUpscaling: result.oldUpscaling,
          newUpscaling: result.newUpscaling,
          effectiveDate: result.effectiveDate,
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to upscale pricing: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get current active price upscaling factors
   */
  @Get("upscaling/current")
  async getCurrentPriceUpscaling() {
    try {
      const upscaling = await this.llmPricingService.getCurrentPriceUpscaling();
      return {
        success: true,
        data: upscaling,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch current price upscaling",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Remove current price upscaling (revert to base pricing)
   */
  @Post("upscaling/remove")
  async removePriceUpscaling(@Body() data: { reason?: string }) {
    try {
      const removed = await this.llmPricingService.removePriceUpscaling(
        data.reason || "Manual removal via admin interface",
        "admin",
      );

      if (!removed) {
        return {
          success: false,
          message: "No active price upscaling found to remove",
        };
      }

      return {
        success: true,
        message: "Successfully removed price upscaling",
      };
    } catch (error) {
      throw new HttpException(
        `Failed to remove price upscaling: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get comprehensive pricing status including cache and scraping health
   */
  @Get("status")
  async getPricingStatus() {
    try {
      const status = await this.llmPricingService.getPricingStatus();
      return {
        success: true,
        data: status,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch pricing status",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test scraping functionality for a specific model
   */
  @Get("test-scraping")
  async testScraping(@Query("modelKey") modelKey: string) {
    if (!modelKey) {
      throw new HttpException("modelKey is required", HttpStatus.BAD_REQUEST);
    }

    try {
      const result =
        await this.llmPricingService.testScrapingForModel(modelKey);
      return {
        success: result.success,
        data: result,
      };
    } catch {
      throw new HttpException(
        "Failed to test scraping functionality",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get cache status and statistics
   */
  @Get("cache-status")
  async getCacheStatus() {
    try {
      const status = this.llmPricingService.getCacheStatus();
      return {
        success: true,
        data: status,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch cache status",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear web scraping cache
   */
  @Post("clear-cache")
  async clearCache() {
    try {
      this.llmPricingService.clearWebScrapingCache();
      return {
        success: true,
        message: "Web scraping cache cleared successfully",
      };
    } catch {
      throw new HttpException(
        "Failed to clear cache",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
