/* eslint-disable */
import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import request from "supertest";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { CacheService } from "../../../cache/cache.service";
import { PrismaService } from "../../../database/prisma.service";
import { LLMPricingService } from "../../llm/core/services/llm-pricing.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { AdminModule } from "../admin.module";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

describe("LLMPricingController (Integration)", () => {
  let app: INestApplication;
  let llmPricingService: LLMPricingService;

  const mockLLMPricingService = {
    getSupportedModels: jest.fn(),
    getPricingHistory: jest.fn(),
    getPricingStatistics: jest.fn(),
    fetchCurrentPricing: jest.fn(),
    updatePricingHistory: jest.fn(),
    calculateCostWithBreakdown: jest.fn(),
    applyPriceUpscaling: jest.fn(),
    getCurrentPriceUpscaling: jest.fn(),
    removePriceUpscaling: jest.fn(),
    getPricingStatus: jest.fn(),
    testScrapingForModel: jest.fn(),
    getCacheStatus: jest.fn(),
    clearWebScrapingCache: jest.fn(),
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
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    lLMModel: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    assignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    getOrSet: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserSession = {
    userId: "test-user-123",
    role: UserRole.ADMIN,
    sessionToken: "test-token",
    assignmentId: 1,
    groupId: "test-group",
  };

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
      .overrideProvider(LLM_PRICING_SERVICE)
      .useValue(mockLLMPricingService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
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

    llmPricingService =
      moduleFixture.get<LLMPricingService>(LLM_PRICING_SERVICE);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /v1/llm-pricing/current", () => {
    it("should return current pricing for all models", async () => {
      const mockModels = [
        {
          id: 1,
          modelKey: "gpt-4o",
          displayName: "GPT-4o",
          provider: "OpenAI",
          isActive: true,
          pricingHistory: [
            {
              inputTokenPrice: 0.0000025,
              outputTokenPrice: 0.00001,
              effectiveDate: new Date().toISOString(),
            },
          ],
        },
      ];

      mockLLMPricingService.getSupportedModels.mockResolvedValue(mockModels);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-pricing/current")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(mockLLMPricingService.getSupportedModels).toHaveBeenCalled();
    });
  });

  describe("GET /v1/llm-pricing/history", () => {
    it("should return pricing history for a model", async () => {
      const mockHistory = [
        {
          id: 1,
          inputTokenPrice: 0.0000025,
          outputTokenPrice: 0.00001,
          effectiveDate: new Date().toISOString(),
          source: "API",
          isActive: true,
          createdAt: new Date().toISOString(),
          metadata: {},
        },
      ];

      mockLLMPricingService.getPricingHistory.mockResolvedValue(mockHistory);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-pricing/history")
        .query({ modelKey: "gpt-4o", limit: "10" })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.history).toEqual(mockHistory);
      expect(mockLLMPricingService.getPricingHistory).toHaveBeenCalledWith(
        "gpt-4o",
        10
      );
    });

    it("should return 400 if modelKey is missing", async () => {
      await request(app.getHttpServer())
        .get("/v1/llm-pricing/history")
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("GET /v1/llm-pricing/statistics", () => {
    it("should return pricing statistics", async () => {
      const mockStats = {
        totalModels: 10,
        activeModels: 8,
        averageInputPrice: 0.000002,
        averageOutputPrice: 0.000005,
      };

      mockLLMPricingService.getPricingStatistics.mockResolvedValue(mockStats);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-pricing/statistics")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
    });
  });

  describe("POST /v1/llm-pricing/refresh", () => {
    it("should refresh pricing data", async () => {
      const mockPricing = [
        {
          modelKey: "gpt-4o",
          inputTokenPrice: 0.0000025,
          outputTokenPrice: 0.00001,
        },
      ];

      mockLLMPricingService.fetchCurrentPricing.mockResolvedValue(mockPricing);
      mockLLMPricingService.updatePricingHistory.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .post("/v1/llm-pricing/refresh")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.updatedModels).toBe(1);
    });
  });

  describe("GET /v1/llm-pricing/calculate-cost", () => {
    it("should calculate cost for token usage", async () => {
      const mockCostBreakdown = {
        modelKey: "gpt-4o",
        tokensIn: 1000,
        tokensOut: 500,
        inputCost: 0.0025,
        outputCost: 0.005,
        totalCost: 0.0075,
        inputTokenPrice: 0.0000025,
        outputTokenPrice: 0.00001,
        pricingEffectiveDate: new Date().toISOString(),
        calculationSteps: {
          inputCalculation: "1000 tokens × $2.50/1M tokens = $0.0025",
          outputCalculation: "500 tokens × $10.00/1M tokens = $0.005",
          totalCalculation: "$0.0025 + $0.005 = $0.0075",
        },
      };

      mockLLMPricingService.calculateCostWithBreakdown.mockResolvedValue(
        mockCostBreakdown
      );

      const response = await request(app.getHttpServer())
        .get("/v1/llm-pricing/calculate-cost")
        .query({
          modelKey: "gpt-4o",
          inputTokens: "1000",
          outputTokens: "500",
        })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalCost).toBe(0.0075);
    });

    it("should return 400 if required parameters are missing", async () => {
      await request(app.getHttpServer())
        .get("/v1/llm-pricing/calculate-cost")
        .query({ modelKey: "gpt-4o" })
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("POST /v1/llm-pricing/upscale", () => {
    it("should apply price upscaling", async () => {
      const mockResult = {
        updatedModels: 10,
        oldUpscaling: null,
        newUpscaling: {
          globalFactor: 1.2,
          usageFactors: { grading: 1.5 },
        },
        effectiveDate: new Date().toISOString(),
      };

      mockLLMPricingService.applyPriceUpscaling.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .post("/v1/llm-pricing/upscale")
        .send({
          globalFactor: 1.2,
          usageFactors: { grading: 1.5 },
          reason: "Price increase",
        })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.updatedModels).toBe(10);
    });

    it("should return 400 if no factors provided", async () => {
      await request(app.getHttpServer())
        .post("/v1/llm-pricing/upscale")
        .send({ reason: "Price increase" })
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("GET /v1/llm-pricing/cache-status", () => {
    it("should return cache status", async () => {
      const mockStatus = {
        keys: 50,
        memory: "2MB",
        hits: 1000,
        misses: 50,
      };

      mockLLMPricingService.getCacheStatus.mockReturnValue(mockStatus);

      const response = await request(app.getHttpServer())
        .get("/v1/llm-pricing/cache-status")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStatus);
    });
  });

  describe("POST /v1/llm-pricing/clear-cache", () => {
    it("should clear the cache", async () => {
      mockLLMPricingService.clearWebScrapingCache.mockImplementation(() => {});

      const response = await request(app.getHttpServer())
        .post("/v1/llm-pricing/clear-cache")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(mockLLMPricingService.clearWebScrapingCache).toHaveBeenCalled();
    });
  });
});
