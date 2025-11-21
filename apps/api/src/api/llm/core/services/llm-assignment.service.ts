import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AIFeatureType } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import { LLM_RESOLVER_SERVICE } from "../../llm.constants";
import { LLMResolverService } from "./llm-resolver.service";

export interface FeatureAssignment {
  id: number;
  featureKey: string;
  featureType: AIFeatureType;
  displayName: string;
  description?: string;
  isActive: boolean;
  requiresModel: boolean;
  defaultModelKey?: string;
  assignedModel?: {
    id: number;
    modelKey: string;
    displayName: string;
    provider: string;
    priority: number;
    assignedBy?: string;
    assignedAt: Date;
  };
}

export interface AssignmentRequest {
  featureKey: string;
  modelKey: string;
  priority?: number;
  assignedBy?: string;
  metadata?: any;
}

@Injectable()
export class LLMAssignmentService {
  private readonly logger = new Logger(LLMAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => LLM_RESOLVER_SERVICE))
    private readonly resolverService: LLMResolverService,
  ) {}

  /**
   * Get all AI features with their current model assignments
   */
  async getAllFeatureAssignments(): Promise<FeatureAssignment[]> {
    const features = await this.prisma.aIFeature.findMany({
      include: {
        assignments: {
          where: { isActive: true },
          orderBy: { priority: "desc" },
          take: 1,
          include: {
            model: true,
          },
        },
      },
      orderBy: { displayName: "asc" },
    });

    return features.map((feature) => ({
      id: feature.id,
      featureKey: feature.featureKey,
      featureType: feature.featureType,
      displayName: feature.displayName,
      description: feature.description,
      isActive: feature.isActive,
      requiresModel: feature.requiresModel,
      defaultModelKey: feature.defaultModelKey,
      assignedModel: feature.assignments[0]
        ? {
            id: feature.assignments[0].model.id,
            modelKey: feature.assignments[0].model.modelKey,
            displayName: feature.assignments[0].model.displayName,
            provider: feature.assignments[0].model.provider,
            priority: feature.assignments[0].priority,
            assignedBy: feature.assignments[0].assignedBy,
            assignedAt: feature.assignments[0].assignedAt,
          }
        : undefined,
    }));
  }

  /**
   * Get the assigned model for a specific feature
   */
  async getAssignedModel(featureKey: string): Promise<string | null> {
    const feature = await this.prisma.aIFeature.findUnique({
      where: { featureKey },
      include: {
        assignments: {
          where: { isActive: true },
          orderBy: { priority: "desc" },
          take: 1,
          include: { model: true },
        },
      },
    });

    if (!feature) {
      this.logger.warn(`Feature ${featureKey} not found`);
      return null;
    }

    if (!feature.isActive) {
      this.logger.warn(`Feature ${featureKey} is not active`);
      return null;
    }

    if (feature.assignments.length > 0) {
      return feature.assignments[0].model.modelKey;
    }

    if (feature.defaultModelKey) {
      this.logger.debug(
        `Using default model ${feature.defaultModelKey} for feature ${featureKey}`,
      );
      return feature.defaultModelKey;
    }

    this.logger.warn(
      `No model assigned to feature ${featureKey} and no default model`,
    );
    return null;
  }

  /**
   * Assign a model to a feature
   */
  async assignModelToFeature(request: AssignmentRequest): Promise<boolean> {
    const {
      featureKey,
      modelKey,
      priority = 100,
      assignedBy,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metadata,
    } = request;

    try {
      const feature = await this.prisma.aIFeature.findUnique({
        where: { featureKey },
      });

      if (!feature) {
        throw new NotFoundException(`Feature ${featureKey} not found`);
      }

      const model = await this.prisma.lLMModel.findUnique({
        where: { modelKey },
      });

      if (!model) {
        throw new NotFoundException(`Model ${modelKey} not found`);
      }

      if (!model.isActive) {
        throw new Error(`Model ${modelKey} is not active`);
      }

      const existingAssignment =
        await this.prisma.lLMFeatureAssignment.findUnique({
          where: {
            featureId_modelId: {
              featureId: feature.id,
              modelId: model.id,
            },
          },
        });

      await (existingAssignment
        ? this.prisma.lLMFeatureAssignment.update({
            where: { id: existingAssignment.id },
            data: {
              isActive: true,
              priority,
              assignedBy,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              metadata,
              assignedAt: new Date(),
              deactivatedAt: null,
            },
          })
        : this.prisma.lLMFeatureAssignment.create({
            data: {
              featureId: feature.id,
              modelId: model.id,
              isActive: true,
              priority,
              assignedBy,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              metadata,
            },
          }));

      await this.prisma.lLMFeatureAssignment.updateMany({
        where: {
          featureId: feature.id,
          modelId: { not: model.id },
          isActive: true,
        },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
        },
      });

      this.resolverService.clearCacheForFeature(featureKey);

      this.logger.log(
        `Assigned model ${modelKey} to feature ${featureKey} by ${
          assignedBy || "system"
        }`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to assign model ${modelKey} to feature ${featureKey}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Remove model assignment from a feature (revert to default)
   */
  async removeFeatureAssignment(
    featureKey: string,
    assignedBy?: string,
  ): Promise<boolean> {
    try {
      const feature = await this.prisma.aIFeature.findUnique({
        where: { featureKey },
      });

      if (!feature) {
        throw new NotFoundException(`Feature ${featureKey} not found`);
      }

      const result = await this.prisma.lLMFeatureAssignment.updateMany({
        where: {
          featureId: feature.id,
          isActive: true,
        },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
        },
      });

      this.resolverService.clearCacheForFeature(featureKey);

      this.logger.log(
        `Removed model assignment for feature ${featureKey} by ${
          assignedBy || "system"
        }`,
      );
      return result.count > 0;
    } catch (error) {
      this.logger.error(
        `Failed to remove assignment for feature ${featureKey}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get assignment history for a feature
   */
  async getFeatureAssignmentHistory(featureKey: string, limit = 10) {
    const feature = await this.prisma.aIFeature.findUnique({
      where: { featureKey },
    });

    if (!feature) {
      throw new NotFoundException(`Feature ${featureKey} not found`);
    }

    return await this.prisma.lLMFeatureAssignment.findMany({
      where: { featureId: feature.id },
      include: { model: true },
      orderBy: { assignedAt: "desc" },
      take: limit,
    });
  }

  /**
   * Get all available models for assignment
   */
  async getAvailableModels() {
    return await this.prisma.lLMModel.findMany({
      where: { isActive: true },
      include: {
        pricingHistory: {
          where: { isActive: true },
          orderBy: { effectiveDate: "desc" },
          take: 1,
        },
        featureAssignments: {
          where: { isActive: true },
          include: { feature: true },
        },
      },
      orderBy: { displayName: "asc" },
    });
  }

  /**
   * Get assignment statistics
   */
  async getAssignmentStatistics() {
    const totalFeatures = await this.prisma.aIFeature.count();
    const activeFeatures = await this.prisma.aIFeature.count({
      where: { isActive: true },
    });
    const featuresWithAssignments = await this.prisma.aIFeature.count({
      where: {
        assignments: {
          some: { isActive: true },
        },
      },
    });
    const featuresUsingDefaults = activeFeatures - featuresWithAssignments;

    const modelUsage = await this.prisma.lLMFeatureAssignment.groupBy({
      by: ["modelId"],
      where: { isActive: true },
      _count: { featureId: true },
      orderBy: { _count: { featureId: "desc" } },
    });

    const modelUsageWithNames = await Promise.all(
      modelUsage.map(async (usage) => {
        const model = await this.prisma.lLMModel.findUnique({
          where: { id: usage.modelId },
          select: { modelKey: true, displayName: true },
        });
        return {
          modelKey: model?.modelKey || "unknown",
          displayName: model?.displayName || "Unknown",
          featureCount: usage._count.featureId,
        };
      }),
    );

    return {
      totalFeatures,
      activeFeatures,
      featuresWithAssignments,
      featuresUsingDefaults,
      modelUsage: modelUsageWithNames,
    };
  }

  /**
   * Bulk update feature assignments
   */
  async bulkUpdateAssignments(
    assignments: AssignmentRequest[],
    assignedBy?: string,
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const assignment of assignments) {
      try {
        await this.assignModelToFeature({
          ...assignment,
          assignedBy: assignedBy || assignment.assignedBy,
        });
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `${assignment.featureKey}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    this.logger.log(
      `Bulk update completed: ${results.success} success, ${results.failed} failed`,
    );
    return results;
  }

  /**
   * Reset all assignments to defaults
   */
  async resetToDefaults(assignedBy?: string): Promise<number> {
    const featuresWithDefaults = await this.prisma.aIFeature.findMany({
      where: {
        defaultModelKey: { not: null },
        isActive: true,
      },
    });

    let resetCount = 0;
    for (const feature of featuresWithDefaults) {
      try {
        await this.assignModelToFeature({
          featureKey: feature.featureKey,
          modelKey: feature.defaultModelKey,
          assignedBy: assignedBy || "SYSTEM_RESET",
        });
        resetCount++;
      } catch (error) {
        this.logger.error(
          `Failed to reset feature ${feature.featureKey}:`,
          error,
        );
      }
    }

    this.logger.log(`Reset ${resetCount} features to default models`);
    return resetCount;
  }
}
