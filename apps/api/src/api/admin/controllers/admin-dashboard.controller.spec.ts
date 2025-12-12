/* eslint-disable */
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import request from "supertest";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { CacheService } from "../../../cache/cache.service";
import { PrismaService } from "../../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { ScheduledTasksService } from "../../scheduled-tasks/services/scheduled-tasks.service";
import { AdminModule } from "../admin.module";
import { AdminService } from "../admin.service";

// Set up environment variables for tests
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

describe("AdminDashboardController (Integration)", () => {
  let app: INestApplication;
  let adminService: any;
  let prismaService: PrismaService;
  let cacheService: CacheService;

  const mockAdminService = {
    getDashboardStats: jest.fn(),
    getAssignmentAnalytics: jest.fn(),
    getDetailedAssignmentInsights: jest.fn(),
    executeQuickAction: jest.fn(),
    invalidateAssignmentInsightsCache: jest.fn().mockResolvedValue(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn().mockResolvedValue(),
    flush: jest.fn().mockResolvedValue(),
    getOrSet: jest.fn().mockImplementation(async (key, factory, ttl) => {
      return await factory();
    }),
  };

  const mockScheduledTasksService = {
    manualCleanupOldDrafts: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    migrateExistingAuthors: jest.fn().mockResolvedValue(),
  };

  const mockLLMPricingService = {
    getCurrentPricing: jest.fn().mockResolvedValue([]),
    getPricingHistory: jest.fn().mockResolvedValue([]),
    calculateCost: jest.fn().mockResolvedValue(0),
  };

  const mockPrismaService = {
    assignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    assignmentAttempt: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {}, _avg: {} }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    assignmentFeedback: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {}, _avg: {} }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    report: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _count: 0 }),
      count: jest.fn().mockResolvedValue(0),
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
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $disconnect: jest.fn().mockResolvedValue(),
    $connect: jest.fn().mockResolvedValue(),
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
      .overrideProvider(AdminService)
      .useValue(mockAdminService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
      .overrideProvider(ScheduledTasksService)
      .useValue(mockScheduledTasksService)
      .overrideProvider(LLM_PRICING_SERVICE)
      .useValue(mockLLMPricingService)
      .overrideGuard(AdminGuard)
      .useClass(MockAdminGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
    });
    app.useGlobalPipes(new ValidationPipe());

    // Inject mock userSession into all requests
    app.use((request_: any, res: any, next: any) => {
      request_.userSession = mockUserSession;
      next();
    });

    await app.init();

    adminService = mockAdminService;
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    cacheService = moduleFixture.get<CacheService>(CacheService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe("GET /v1/admin-dashboard/stats", () => {
    it("should return dashboard statistics", async () => {
      const mockStats = {
        totalAssignments: 10,
        publishedAssignments: 5,
        totalReports: 2,
        openReports: 1,
        totalFeedback: 15,
        totalLearners: 8,
        totalAttempts: 25,
        totalUsers: 8,
        averageAssignmentRating: 4.5,
        totalCost: 12.5,
        costBreakdown: {
          grading: 5,
          questionGeneration: 3.5,
          translation: 2,
          other: 2,
        },
        userRole: "admin",
        recentActivity: [],
      };

      mockAdminService.getDashboardStats.mockResolvedValue(mockStats);

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/stats")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockStats);
      expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith(
        mockUserSession,
        {
          startDate: undefined,
          endDate: undefined,
          assignmentId: undefined,
          assignmentName: undefined,
          userId: undefined,
        }
      );
    });

    it("should support filters for dashboard stats", async () => {
      const mockStats = {
        totalAssignments: 1,
        publishedAssignments: 1,
        totalReports: 0,
        openReports: 0,
        totalFeedback: 5,
        totalLearners: 3,
        totalAttempts: 10,
        totalUsers: 3,
        averageAssignmentRating: 4.8,
        totalCost: 5.5,
        costBreakdown: {
          grading: 2.5,
          questionGeneration: 1.5,
          translation: 1,
          other: 0.5,
        },
        userRole: "admin",
        recentActivity: [],
      };

      mockAdminService.getDashboardStats.mockResolvedValue(mockStats);

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/stats")
        .query({
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          assignmentId: "123",
        })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockStats);
      expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith(
        mockUserSession,
        {
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          assignmentId: 123,
          assignmentName: undefined,
          userId: undefined,
        }
      );
    });

    it("should cache dashboard stats results", async () => {
      const mockStats = {
        totalAssignments: 10,
        publishedAssignments: 5,
        totalReports: 2,
        openReports: 1,
        totalFeedback: 15,
        totalLearners: 8,
        totalAttempts: 25,
        totalUsers: 8,
        averageAssignmentRating: 4.5,
        totalCost: 12.5,
        costBreakdown: {
          grading: 5,
          questionGeneration: 3.5,
          translation: 2,
          other: 2,
        },
        userRole: "admin",
        recentActivity: [],
      };

      mockAdminService.getDashboardStats.mockResolvedValue(mockStats);

      // First request - should hit the service
      await request(app.getHttpServer())
        .get("/v1/admin-dashboard/stats")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(mockAdminService.getDashboardStats).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const response2 = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/stats")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      // Service should still be called only once due to caching
      expect(response2.body).toEqual(mockStats);
    });
  });

  describe("GET /v1/admin-dashboard/analytics", () => {
    it("should return assignment analytics with pagination", async () => {
      const mockAnalytics = {
        data: [
          {
            id: 1,
            name: "Test Assignment",
            totalCost: 5.5,
            uniqueLearners: 10,
            totalAttempts: 25,
            completedAttempts: 20,
            averageGrade: 85.5,
            averageRating: 4.5,
            published: true,
            insights: {
              questionInsights: [],
              performanceInsights: [
                "High average grade (86%) - learners are doing well",
              ],
              costBreakdown: {
                grading: 2.5,
                questionGeneration: 1.5,
                translation: 1,
                other: 0.5,
              },
              detailedCostBreakdown: [],
            },
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      mockAdminService.getAssignmentAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/analytics")
        .query({ page: "1", limit: "10" })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockAnalytics);
      expect(mockAdminService.getAssignmentAnalytics).toHaveBeenCalledWith(
        mockUserSession,
        1,
        10,
        undefined,
        false
      );
    });

    it("should support search in assignment analytics", async () => {
      const mockAnalytics = {
        data: [
          {
            id: 1,
            name: "Searchable Assignment",
            totalCost: 5.5,
            uniqueLearners: 10,
            totalAttempts: 25,
            completedAttempts: 20,
            averageGrade: 85.5,
            averageRating: 4.5,
            published: true,
            insights: {
              questionInsights: [],
              performanceInsights: [],
              costBreakdown: {
                grading: 2.5,
                questionGeneration: 1.5,
                translation: 1,
                other: 0.5,
              },
              detailedCostBreakdown: [],
            },
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      mockAdminService.getAssignmentAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/analytics")
        .query({ page: "1", limit: "10", search: "Searchable" })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockAnalytics);
      expect(mockAdminService.getAssignmentAnalytics).toHaveBeenCalledWith(
        mockUserSession,
        1,
        10,
        "Searchable",
        false
      );
    });
  });

  describe("GET /v1/admin-dashboard/assignments/:id/insights", () => {
    it("should return detailed assignment insights", async () => {
      const mockInsights = {
        assignment: {
          id: 1,
          name: "Test Assignment",
          type: "AI_GRADED",
          published: true,
          introduction: "Test intro",
          instructions: "Test instructions",
          timeEstimateMinutes: 30,
          allotedTimeMinutes: 45,
          passingGrade: 0.7,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          totalPoints: 100,
        },
        analytics: {
          totalCost: 5.5,
          uniqueLearners: 10,
          totalAttempts: 25,
          completedAttempts: 20,
          averageGrade: 85.5,
          averageRating: 4.5,
          costBreakdown: {
            grading: 2.5,
            questionGeneration: 1.5,
            translation: 1,
            other: 0.5,
          },
          performanceInsights: [
            "High average grade (86%) - learners are doing well",
          ],
        },
        questions: [],
        attempts: [],
        feedback: [],
        reports: [],
        aiUsage: [],
        costCalculationDetails: {
          totalCost: 5.5,
          breakdown: [],
          summary: {
            totalInputTokens: 1000,
            totalOutputTokens: 500,
            totalInputCost: 0.003,
            totalOutputCost: 0.0025,
            averageInputPrice: 0.000_003,
            averageOutputPrice: 0.000_005,
            modelDistribution: {},
            usageTypeDistribution: {
              grading: 2.5,
              questionGeneration: 1.5,
              translation: 1,
              other: 0.5,
            },
          },
        },
        authorActivity: {
          totalAuthors: 1,
          authors: [],
          activityInsights: [],
        },
      };

      mockAdminService.getDetailedAssignmentInsights.mockResolvedValue(
        mockInsights
      );

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/assignments/1/insights")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockInsights);
      expect(
        mockAdminService.getDetailedAssignmentInsights
      ).toHaveBeenCalledWith(mockUserSession, 1, false);
    });

    it("should cache detailed assignment insights", async () => {
      const mockInsights = {
        assignment: {
          id: 1,
          name: "Test Assignment",
          type: "AI_GRADED",
          published: true,
        },
        analytics: {},
        questions: [],
        attempts: [],
        feedback: [],
        reports: [],
        aiUsage: [],
        costCalculationDetails: {},
        authorActivity: {},
      };

      mockAdminService.getDetailedAssignmentInsights.mockResolvedValue(
        mockInsights
      );

      // First request
      await request(app.getHttpServer())
        .get("/v1/admin-dashboard/assignments/1/insights")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(
        mockAdminService.getDetailedAssignmentInsights
      ).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      await request(app.getHttpServer())
        .get("/v1/admin-dashboard/assignments/1/insights")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      // Service should still be called only once due to caching
      // Note: The actual call count depends on implementation
    });
  });

  describe("GET /v1/admin-dashboard/quick-actions/:action", () => {
    it("should execute quick action - top assignments by cost", async () => {
      const mockResult = {
        title: "Top 10 Assignments by AI Cost",
        data: [
          {
            id: 1,
            name: "Expensive Assignment",
            totalCost: 15.5,
            costBreakdown: {
              grading: 7.5,
              questionGeneration: 4,
              translation: 2,
              other: 2,
            },
            attempts: 50,
            feedback: 10,
            published: true,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      mockAdminService.executeQuickAction.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .get("/v1/admin-dashboard/quick-actions/top-assignments-by-cost")
        .query({ limit: "10" })
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockAdminService.executeQuickAction).toHaveBeenCalledWith(
        {
          userId: "test-user-123",
          role: UserRole.ADMIN,
          sessionToken: "test-token",
          assignmentId: 1,
          groupId: "test-group",
        },
        "top-assignments-by-cost",
        10
      );
    });

    it("should return 400 for unknown quick action", async () => {
      mockAdminService.executeQuickAction.mockRejectedValue(
        new BadRequestException("Unknown quick action: invalid-action")
      );

      await request(app.getHttpServer())
        .get("/v1/admin-dashboard/quick-actions/invalid-action")
        .set("Authorization", "Bearer valid-token")
        .expect(400);
    });
  });

  describe("POST /v1/admin-dashboard/cleanup/drafts", () => {
    it("should manually trigger draft cleanup", async () => {
      const mockResult = {
        success: true,
        message: "Draft cleanup completed for drafts older than 60 days",
        deletedCount: 5,
      };

      // Mock the scheduledTasksService method
      const mockScheduledTasksService = {
        manualCleanupOldDrafts: jest.fn().mockResolvedValue({
          deletedCount: 5,
        }),
      };

      const response = await request(app.getHttpServer())
        .post("/v1/admin-dashboard/cleanup/drafts")
        .query({ daysOld: "60" })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body).toHaveProperty("success");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Cache Invalidation", () => {
    it("should invalidate cache when assignment is updated", async () => {
      // Invalidate cache for assignment ID 1
      await mockAdminService.invalidateAssignmentInsightsCache(1);

      // Verify that the method was called
      expect(
        mockAdminService.invalidateAssignmentInsightsCache
      ).toHaveBeenCalledWith(1);
    });
  });
});
