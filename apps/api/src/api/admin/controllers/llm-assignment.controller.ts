import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import {
  AssignmentRequest,
  LLMAssignmentService,
} from "../../llm/core/services/llm-assignment.service";
import { LLMResolverService } from "../../llm/core/services/llm-resolver.service";
import {
  LLM_ASSIGNMENT_SERVICE,
  LLM_RESOLVER_SERVICE,
} from "../../llm/llm.constants";

interface AdminSessionRequest extends Request {
  userSession: {
    userId: string;
    role: string;
    sessionToken: string;
  };
}

@ApiTags("Admin LLM Assignments")
@ApiBearerAuth()
@Controller({
  path: "llm-assignments",
  version: "1",
})
@UseGuards(AdminGuard)
export class LLMAssignmentController {
  constructor(
    @Inject(LLM_ASSIGNMENT_SERVICE)
    private readonly assignmentService: LLMAssignmentService,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly resolverService: LLMResolverService,
  ) {}

  /**
   * Get all AI features with their current model assignments
   */
  @Get("features")
  @ApiOperation({
    summary: "Get all AI features with their current model assignments",
  })
  @ApiResponse({
    status: 200,
    description: "Successfully retrieved feature assignments",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - Admin authentication required",
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
  })
  async getAllFeatureAssignments() {
    try {
      const assignments =
        await this.assignmentService.getAllFeatureAssignments();
      return {
        success: true,
        data: assignments,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch feature assignments",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get the assigned model for a specific feature
   */
  @Get("features/:featureKey/model")
  async getAssignedModel(@Param("featureKey") featureKey: string) {
    try {
      const modelKey =
        await this.assignmentService.getAssignedModel(featureKey);

      if (!modelKey) {
        throw new HttpException(
          `No model assigned to feature ${featureKey}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: {
          featureKey,
          assignedModelKey: modelKey,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to fetch assigned model",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Assign a model to a feature
   */
  @Post("assign")
  async assignModelToFeature(
    @Body()
    body: {
      featureKey: string;
      modelKey: string;
      priority?: number;
      metadata?: any;
    },
    @Req() request: AdminSessionRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { featureKey, modelKey, priority, metadata } = body;

    if (!featureKey || !modelKey) {
      throw new HttpException(
        "featureKey and modelKey are required",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const assignmentRequest: AssignmentRequest = {
        featureKey,
        modelKey,
        priority,
        assignedBy: request.userSession.userId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata,
      };

      const success =
        await this.assignmentService.assignModelToFeature(assignmentRequest);

      return {
        success,
        message: `Successfully assigned model ${modelKey} to feature ${featureKey}`,
        data: {
          featureKey,
          modelKey,
          assignedBy: request.userSession.userId,
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to assign model ${modelKey} to feature ${featureKey}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Remove model assignment from a feature (revert to default)
   */
  @Delete("features/:featureKey/assignment")
  async removeFeatureAssignment(
    @Param("featureKey") featureKey: string,
    @Req() request: AdminSessionRequest,
  ) {
    try {
      const success = await this.assignmentService.removeFeatureAssignment(
        featureKey,
        request.userSession.userId,
      );

      if (!success) {
        throw new HttpException(
          `No active assignment found for feature ${featureKey}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        message: `Successfully removed model assignment for feature ${featureKey}`,
        data: {
          featureKey,
          removedBy: request.userSession.userId,
          removedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to remove feature assignment",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get assignment history for a feature
   */
  @Get("features/:featureKey/history")
  async getFeatureAssignmentHistory(
    @Param("featureKey") featureKey: string,
    @Query("limit") limit?: string,
  ) {
    try {
      const parsedLimit = limit ? Number.parseInt(limit, 10) : 10;
      const history = await this.assignmentService.getFeatureAssignmentHistory(
        featureKey,
        parsedLimit,
      );

      return {
        success: true,
        data: {
          featureKey,
          history: history.map((assignment) => ({
            id: assignment.id,
            modelKey: assignment.model.modelKey,
            modelDisplayName: assignment.model.displayName,
            isActive: assignment.isActive,
            priority: assignment.priority,
            assignedBy: assignment.assignedBy,
            assignedAt: assignment.assignedAt,
            deactivatedAt: assignment.deactivatedAt,
            metadata: assignment.metadata,
          })),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to fetch assignment history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all available models for assignment
   */
  @Get("models")
  @ApiOperation({
    summary: "Get all available models for assignment",
  })
  @ApiResponse({
    status: 200,
    description: "Successfully retrieved available models",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - Admin authentication required",
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
  })
  async getAvailableModels() {
    try {
      const models = await this.assignmentService.getAvailableModels();

      return {
        success: true,
        data: models.map((model) => ({
          id: model.id,
          modelKey: model.modelKey,
          displayName: model.displayName,
          provider: model.provider,
          isActive: model.isActive,
          currentPricing: model.pricingHistory[0] || null,
          assignedFeatures: model.featureAssignments.map((assignment) => ({
            featureKey: assignment.feature.featureKey,
            featureDisplayName: assignment.feature.displayName,
            priority: assignment.priority,
          })),
        })),
      };
    } catch {
      throw new HttpException(
        "Failed to fetch available models",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get assignment statistics
   */
  @Get("statistics")
  async getAssignmentStatistics() {
    try {
      const stats = await this.assignmentService.getAssignmentStatistics();
      return {
        success: true,
        data: stats,
      };
    } catch {
      throw new HttpException(
        "Failed to fetch assignment statistics",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Bulk update feature assignments
   */
  @Put("bulk-assign")
  async bulkUpdateAssignments(
    @Body()
    body: {
      assignments: Array<{
        featureKey: string;
        modelKey: string;
        priority?: number;
      }>;
    },
    @Req() request: AdminSessionRequest,
  ) {
    const { assignments } = body;

    if (
      !assignments ||
      !Array.isArray(assignments) ||
      assignments.length === 0
    ) {
      throw new HttpException(
        "assignments array is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate each assignment has required fields
    for (const assignment of assignments) {
      if (!assignment.featureKey || !assignment.modelKey) {
        throw new HttpException(
          "Each assignment must have featureKey and modelKey",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    try {
      const assignmentRequests: AssignmentRequest[] = assignments.map(
        (assignment) => ({
          featureKey: assignment.featureKey,
          modelKey: assignment.modelKey,
          priority: assignment.priority,
          assignedBy: request.userSession.userId,
        }),
      );

      const results = await this.assignmentService.bulkUpdateAssignments(
        assignmentRequests,
        request.userSession.userId,
      );

      return {
        success: results.failed === 0,
        message: `Bulk assignment completed: ${results.success} successful, ${results.failed} failed`,
        data: {
          successful: results.success,
          failed: results.failed,
          errors: results.errors,
          assignedBy: request.userSession.userId,
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to process bulk assignments: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reset all assignments to defaults
   */
  @Post("reset-to-defaults")
  async resetToDefaults(@Req() request: AdminSessionRequest) {
    try {
      const resetCount = await this.assignmentService.resetToDefaults(
        request.userSession.userId,
      );

      return {
        success: true,
        message: `Successfully reset ${resetCount} features to default models`,
        data: {
          resetCount,
          resetBy: request.userSession.userId,
          resetAt: new Date().toISOString(),
        },
      };
    } catch {
      throw new HttpException(
        "Failed to reset assignments to defaults",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test model assignment - get which model would be used for a feature
   */
  @Get("test/:featureKey")
  async testFeatureAssignment(@Param("featureKey") featureKey: string) {
    try {
      const modelKey =
        await this.assignmentService.getAssignedModel(featureKey);

      return {
        success: true,
        data: {
          featureKey,
          resolvedModelKey: modelKey,
          timestamp: new Date().toISOString(),
        },
      };
    } catch {
      throw new HttpException(
        "Failed to test feature assignment",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear cache for a specific feature
   */
  @Post("cache/clear/:featureKey")
  async clearFeatureCache(@Param("featureKey") featureKey: string) {
    try {
      this.resolverService.clearCacheForFeature(featureKey);

      return {
        success: true,
        message: `Cache cleared for feature ${featureKey}`,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new HttpException(
        "Failed to clear feature cache",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear all model assignment cache
   */
  @Post("cache/clear-all")
  async clearAllCache() {
    try {
      this.resolverService.clearAllCache();

      return {
        success: true,
        message: "All model assignment cache cleared",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new HttpException(
        "Failed to clear cache",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get cache statistics
   */
  @Get("cache/stats")
  async getCacheStats() {
    try {
      const stats = this.resolverService.getCacheStats();

      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new HttpException(
        "Failed to get cache stats",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
