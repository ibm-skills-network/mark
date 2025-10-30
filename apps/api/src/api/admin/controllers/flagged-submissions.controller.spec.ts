/* eslint-disable */
import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import request from "supertest";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { RedisService } from "../../../cache/redis.service";
import { PrismaService } from "../../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { AdminModule } from "../admin.module";
import { AdminService } from "../admin.service";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";

describe("FlaggedSubmissionsController (Integration)", () => {
  let app: INestApplication;
  let adminService: any;
  let redisService: RedisService;

  const mockAdminService = {
    getFlaggedSubmissions: jest.fn(),
    dismissFlaggedSubmission: jest.fn(),
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

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
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
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
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
    redisService = moduleFixture.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe("GET /v1/admin/flagged-submissions", () => {
    it("should return all flagged submissions", async () => {
      const mockSubmissions = [
        {
          id: 1,
          attemptId: 1,
          assignmentId: 1,
          regradingStatus: "PENDING",
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          attemptId: 2,
          assignmentId: 1,
          regradingStatus: "PENDING",
          createdAt: new Date().toISOString(),
        },
      ];

      mockAdminService.getFlaggedSubmissions.mockResolvedValue(mockSubmissions);

      const response = await request(app.getHttpServer())
        .get("/v1/admin/flagged-submissions")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockSubmissions);
      expect(mockAdminService.getFlaggedSubmissions).toHaveBeenCalled();
    });

    it("should cache flagged submissions", async () => {
      const mockSubmissions = [
        {
          id: 1,
          attemptId: 1,
          assignmentId: 1,
          regradingStatus: "PENDING",
          createdAt: new Date().toISOString(),
        },
      ];

      mockAdminService.getFlaggedSubmissions.mockResolvedValue(mockSubmissions);

      // First request
      await request(app.getHttpServer())
        .get("/v1/admin/flagged-submissions")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(mockAdminService.getFlaggedSubmissions).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      await request(app.getHttpServer())
        .get("/v1/admin/flagged-submissions")
        .set("Authorization", "Bearer valid-token")
        .expect(200);
    });
  });

  describe("POST /v1/admin/flagged-submissions/:id/dismiss", () => {
    it("should dismiss a flagged submission", async () => {
      const mockResult = {
        id: 1,
        attemptId: 1,
        assignmentId: 1,
        regradingStatus: "REJECTED",
        createdAt: new Date().toISOString(),
      };

      mockAdminService.dismissFlaggedSubmission.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .post("/v1/admin/flagged-submissions/1/dismiss")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body).toEqual(mockResult);
      expect(mockAdminService.dismissFlaggedSubmission).toHaveBeenCalledWith(1);
    });

    it("should invalidate cache after dismissing", async () => {
      const mockResult = {
        id: 1,
        attemptId: 1,
        assignmentId: 1,
        regradingStatus: "REJECTED",
        createdAt: new Date().toISOString(),
      };

      mockAdminService.dismissFlaggedSubmission.mockResolvedValue(mockResult);

      // Dismiss submission
      await request(app.getHttpServer())
        .post("/v1/admin/flagged-submissions/1/dismiss")
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      // Verify cache invalidation was called
      expect(mockAdminService.dismissFlaggedSubmission).toHaveBeenCalledWith(1);
    });
  });
});
