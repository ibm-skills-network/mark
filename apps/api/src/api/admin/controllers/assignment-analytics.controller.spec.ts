/* eslint-disable */
import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import request from "supertest";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { CacheService } from "../../../cache/cache.service";
import { PrismaService } from "../../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { AdminModule } from "../admin.module";
import { AdminService } from "../admin.service";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

describe("AssignmentAnalyticsController (Integration)", () => {
  let app: INestApplication;
  let adminService: any;

  const mockAdminService = {
    getBasicAssignmentAnalytics: jest.fn(),
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

  const mockLLMPricingService = {
    getCurrentPricing: jest.fn().mockResolvedValue([]),
    getPricingHistory: jest.fn().mockResolvedValue([]),
    calculateCost: jest.fn().mockResolvedValue(0),
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
      .overrideProvider(AdminService)
      .useValue(mockAdminService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
      .overrideProvider(LLM_PRICING_SERVICE)
      .useValue(mockLLMPricingService)
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

    adminService = mockAdminService;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe("GET /v1/admin/assignments/:id/analytics", () => {
    it("should return analytics for a specific assignment", async () => {
      const mockAnalytics = {
        averageScore: 85.5,
        medianScore: 87.0,
        completionRate: 80.0,
        totalAttempts: 25,
        averageCompletionTime: 30,
        scoreDistribution: [],
        questionBreakdown: [],
        uniqueUsers: 10,
      };

      mockAdminService.getBasicAssignmentAnalytics.mockResolvedValue(
        mockAnalytics
      );

      const response = await request(app.getHttpServer())
        .get("/v1/admin/assignments/1/analytics")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockAnalytics);
      expect(mockAdminService.getBasicAssignmentAnalytics).toHaveBeenCalledWith(
        1
      );
    });

    it("should handle non-existent assignment", async () => {
      mockAdminService.getBasicAssignmentAnalytics.mockRejectedValue(
        new Error("Assignment with ID 999 not found")
      );

      await request(app.getHttpServer())
        .get("/v1/admin/assignments/999/analytics")
        .set("Authorization", "Bearer valid-token")
        .expect(500);
    });

    it("should cache analytics results", async () => {
      const mockAnalytics = {
        averageScore: 85.5,
        medianScore: 87.0,
        completionRate: 80.0,
        totalAttempts: 25,
        averageCompletionTime: 30,
        scoreDistribution: [],
        questionBreakdown: [],
        uniqueUsers: 10,
      };

      mockAdminService.getBasicAssignmentAnalytics.mockResolvedValue(
        mockAnalytics
      );

      // First request
      await request(app.getHttpServer())
        .get("/v1/admin/assignments/1/analytics")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      // Second request - should use cache
      const response = await request(app.getHttpServer())
        .get("/v1/admin/assignments/1/analytics")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockAnalytics);
    });
  });
});
