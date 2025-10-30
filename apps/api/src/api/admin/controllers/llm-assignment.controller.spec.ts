/* eslint-disable */
import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import request from "supertest";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { RedisService } from "../../../cache/redis.service";
import { PrismaService } from "../../../database/prisma.service";
import { LLMAssignmentService } from "../../llm/core/services/llm-assignment.service";
import { LLMResolverService } from "../../llm/core/services/llm-resolver.service";
import {
  LLM_ASSIGNMENT_SERVICE,
  LLM_RESOLVER_SERVICE,
} from "../../llm/llm.constants";
import { AdminModule } from "../admin.module";

// Set up environment variables for tests
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";

describe("LLMAssignmentController (Integration)", () => {
  let app: INestApplication;
  let assignmentService: LLMAssignmentService;
  let resolverService: LLMResolverService;

  const mockAssignmentService = {
    getAllFeatureAssignments: jest.fn(),
    getAssignedModel: jest.fn(),
    assignModelToFeature: jest.fn(),
    removeFeatureAssignment: jest.fn(),
    getFeatureAssignmentHistory: jest.fn(),
    getAvailableModels: jest.fn(),
    getAssignmentStatistics: jest.fn(),
    bulkUpdateAssignments: jest.fn(),
    resetToDefaults: jest.fn(),
  };

  const mockResolverService = {
    clearCacheForFeature: jest.fn(),
    clearAllCache: jest.fn(),
    getCacheStats: jest.fn(),
  };

  const mockPrismaService = {
    report: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    aIUsage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    lLMPricing: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    lLMModel: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserSession = {
    userId: "test-user-123",
    role: UserRole.ADMIN,
    sessionToken: "test-token",
    assignmentId: 1,
    groupId: "test-group",
  };

  // Mock guard that allows all requests
  class MockAdminGuard {
    canActivate() {
      return true;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        WinstonModule.forRoot({
          transports: [],
        }),
        AdminModule,
      ],
    })
      .overrideProvider(LLM_ASSIGNMENT_SERVICE)
      .useValue(mockAssignmentService)
      .overrideProvider(LLM_RESOLVER_SERVICE)
      .useValue(mockResolverService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideGuard(AdminGuard)
      .useClass(MockAdminGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
    });

    // Inject mock userSession into all requests
    app.use((req: any, res: any, next: any) => {
      req.userSession = mockUserSession;
      req.adminSession = {
        email: "admin@test.com",
        role: UserRole.ADMIN,
        sessionToken: "test-token",
      };
      next();
    });

    await app.init();

    assignmentService = moduleFixture.get<LLMAssignmentService>(
      LLM_ASSIGNMENT_SERVICE
    );
    resolverService =
      moduleFixture.get<LLMResolverService>(LLM_RESOLVER_SERVICE);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /v1/llm-assignments/features", () => {
    it("should return all feature assignments", async () => {
      const mockFeatures = [
        {
          featureKey: "grading",
          displayName: "Grading",
          assignedModel: "gpt-4o",
          isActive: true,
        },
      ];

      mockAssignmentService.getAllFeatureAssignments.mockResolvedValue(
        mockFeatures
      );

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/features")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockFeatures);
    });
  });

  describe("GET /v1/llm-assignments/features/:featureKey/model", () => {
    it("should return assigned model for a feature", async () => {
      mockAssignmentService.getAssignedModel.mockResolvedValue("gpt-4o");

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/features/grading/model")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.assignedModelKey).toBe("gpt-4o");
    });

    it("should return 404 if no model is assigned", async () => {
      mockAssignmentService.getAssignedModel.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get("/v1/llm-assignments/features/unknown/model")
        .set("Authorization", "Bearer valid-token")
        .expect(404);
    });
  });

  describe("POST /v1/llm-assignments/assign", () => {
    it("should assign a model to a feature", async () => {
      mockAssignmentService.assignModelToFeature.mockResolvedValue(true);

      const response = await request(app.getHttpServer())
        .post("/v1/llm-assignments/assign")
        .send({
          featureKey: "grading",
          modelKey: "gpt-4o",
          priority: 1,
        })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.modelKey).toBe("gpt-4o");
    });

    it("should return 400 if required fields are missing", async () => {
      await request(app.getHttpServer())
        .post("/v1/llm-assignments/assign")
        .send({ featureKey: "grading" })
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("DELETE /v1/llm-assignments/features/:featureKey/assignment", () => {
    it("should remove feature assignment", async () => {
      mockAssignmentService.removeFeatureAssignment.mockResolvedValue(true);

      const response = await request(app.getHttpServer())
        .delete("/v1/llm-assignments/features/grading/assignment")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("removed");
    });

    it("should return 404 if no active assignment found", async () => {
      mockAssignmentService.removeFeatureAssignment.mockResolvedValue(false);

      await request(app.getHttpServer())
        .delete("/v1/llm-assignments/features/unknown/assignment")
        .set("Authorization", "Bearer valid-token")
        .expect(404);
    });
  });

  describe("GET /v1/llm-assignments/features/:featureKey/history", () => {
    it("should return assignment history", async () => {
      const mockHistory = [
        {
          id: 1,
          model: {
            modelKey: "gpt-4o",
            displayName: "GPT-4o",
          },
          isActive: true,
          priority: 1,
          assignedBy: "admin@test.com",
          assignedAt: new Date(),
          deactivatedAt: null,
          metadata: {},
        },
      ];

      mockAssignmentService.getFeatureAssignmentHistory.mockResolvedValue(
        mockHistory
      );

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/features/grading/history")
        .query({ limit: "10" })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.history).toHaveLength(1);
    });
  });

  describe("GET /v1/llm-assignments/models", () => {
    it("should return available models", async () => {
      const mockModels = [
        {
          id: 1,
          modelKey: "gpt-4o",
          displayName: "GPT-4o",
          provider: "OpenAI",
          isActive: true,
          pricingHistory: [],
          featureAssignments: [],
        },
      ];

      mockAssignmentService.getAvailableModels.mockResolvedValue(mockModels);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/models")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("GET /v1/llm-assignments/statistics", () => {
    it("should return assignment statistics", async () => {
      const mockStats = {
        totalFeatures: 5,
        assignedFeatures: 4,
        unassignedFeatures: 1,
        totalModels: 10,
        activeModels: 8,
      };

      mockAssignmentService.getAssignmentStatistics.mockResolvedValue(
        mockStats
      );

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/statistics")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
    });
  });

  describe("PUT /v1/llm-assignments/bulk-assign", () => {
    it("should bulk update assignments", async () => {
      const mockResult = {
        success: 2,
        failed: 0,
        errors: [],
      };

      mockAssignmentService.bulkUpdateAssignments.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .put("/v1/llm-assignments/bulk-assign")
        .send({
          assignments: [
            { featureKey: "grading", modelKey: "gpt-4o" },
            { featureKey: "translation", modelKey: "gpt-4o-mini" },
          ],
        })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.successful).toBe(2);
    });

    it("should return 400 if assignments array is empty", async () => {
      await request(app.getHttpServer())
        .put("/v1/llm-assignments/bulk-assign")
        .send({ assignments: [] })
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("POST /v1/llm-assignments/reset-to-defaults", () => {
    it("should reset all assignments to defaults", async () => {
      mockAssignmentService.resetToDefaults.mockResolvedValue(5);

      const response = await request(app.getHttpServer())
        .post("/v1/llm-assignments/reset-to-defaults")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.resetCount).toBe(5);
    });
  });

  describe("GET /v1/llm-assignments/test/:featureKey", () => {
    it("should test feature assignment", async () => {
      mockAssignmentService.getAssignedModel.mockResolvedValue("gpt-4o");

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/test/grading")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.resolvedModelKey).toBe("gpt-4o");
    });
  });

  describe("POST /v1/llm-assignments/cache/clear/:featureKey", () => {
    it("should clear cache for a feature", async () => {
      mockResolverService.clearCacheForFeature.mockImplementation(() => {});

      const response = await request(app.getHttpServer())
        .post("/v1/llm-assignments/cache/clear/grading")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(mockResolverService.clearCacheForFeature).toHaveBeenCalledWith(
        "grading"
      );
    });
  });

  describe("POST /v1/llm-assignments/cache/clear-all", () => {
    it("should clear all cache", async () => {
      mockResolverService.clearAllCache.mockImplementation(() => {});

      const response = await request(app.getHttpServer())
        .post("/v1/llm-assignments/cache/clear-all")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(mockResolverService.clearAllCache).toHaveBeenCalled();
    });
  });

  describe("GET /v1/llm-assignments/cache/stats", () => {
    it("should return cache statistics", async () => {
      const mockStats = {
        keys: 50,
        hits: 1000,
        misses: 50,
        hitRate: 95.24,
      };

      mockResolverService.getCacheStats.mockReturnValue(mockStats);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-assignments/cache/stats")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
    });
  });
});
