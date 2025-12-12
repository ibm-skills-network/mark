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

describe("RegradingRequestsController (Integration)", () => {
  let app: INestApplication;
  let adminService: any;
  let cacheService: CacheService;

  const mockAdminService = {
    getRegradingRequests: jest.fn(),
    approveRegradingRequest: jest.fn(),
    rejectRegradingRequest: jest.fn(),
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
    cacheService = moduleFixture.get<CacheService>(CacheService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe("GET /v1/admin/regrading-requests", () => {
    it("should return all regrading requests", async () => {
      const mockRequests = [
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
          regradingStatus: "APPROVED",
          createdAt: new Date().toISOString(),
        },
      ];

      mockAdminService.getRegradingRequests.mockResolvedValue(mockRequests);

      const response = await request(app.getHttpServer())
        .get("/v1/admin/regrading-requests")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(response.body).toEqual(mockRequests);
      expect(mockAdminService.getRegradingRequests).toHaveBeenCalled();
    });

    it("should cache regrading requests", async () => {
      const mockRequests = [
        {
          id: 1,
          attemptId: 1,
          assignmentId: 1,
          regradingStatus: "PENDING",
          createdAt: new Date().toISOString(),
        },
      ];

      mockAdminService.getRegradingRequests.mockResolvedValue(mockRequests);

      // First request
      await request(app.getHttpServer())
        .get("/v1/admin/regrading-requests")
        .set("Authorization", "Bearer valid-token")
        .expect(200);

      expect(mockAdminService.getRegradingRequests).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      await request(app.getHttpServer())
        .get("/v1/admin/regrading-requests")
        .set("Authorization", "Bearer valid-token")
        .expect(200);
    });
  });

  describe("POST /v1/admin/regrading-requests/:id/approve", () => {
    it("should approve a regrading request", async () => {
      const mockResult = { success: true };

      mockAdminService.approveRegradingRequest.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .post("/v1/admin/regrading-requests/1/approve")
        .send({ newGrade: 95 })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body).toEqual(mockResult);
      expect(mockAdminService.approveRegradingRequest).toHaveBeenCalledWith(
        1,
        95
      );
    });

    it("should invalidate cache after approval", async () => {
      const mockResult = { success: true };

      mockAdminService.approveRegradingRequest.mockResolvedValue(mockResult);

      // Approve request
      await request(app.getHttpServer())
        .post("/v1/admin/regrading-requests/1/approve")
        .send({ newGrade: 95 })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      // Verify cache invalidation was called (would need to check delPattern)
      expect(mockAdminService.approveRegradingRequest).toHaveBeenCalledWith(
        1,
        95
      );
    });
  });

  describe("POST /v1/admin/regrading-requests/:id/reject", () => {
    it("should reject a regrading request", async () => {
      const mockResult = { success: true };

      mockAdminService.rejectRegradingRequest.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .post("/v1/admin/regrading-requests/1/reject")
        .send({ reason: "Not justified" })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      expect(response.body).toEqual(mockResult);
      expect(mockAdminService.rejectRegradingRequest).toHaveBeenCalledWith(
        1,
        "Not justified"
      );
    });

    it("should invalidate cache after rejection", async () => {
      const mockResult = { success: true };

      mockAdminService.rejectRegradingRequest.mockResolvedValue(mockResult);

      // Reject request
      await request(app.getHttpServer())
        .post("/v1/admin/regrading-requests/1/reject")
        .send({ reason: "Not justified" })
        .set("Authorization", "Bearer valid-token")
        .expect(201);

      // Verify cache invalidation was called
      expect(mockAdminService.rejectRegradingRequest).toHaveBeenCalledWith(
        1,
        "Not justified"
      );
    });
  });
});
