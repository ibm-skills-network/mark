import { Test, TestingModule } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import { AdminVerificationService } from "../../auth/services/admin-verification.service";
import { RedisService } from "../../cache/redis.service";
import { PrismaService } from "../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";

describe("AdminController", () => {
  let controller: AdminController;
  const originalDatabaseUrl = process.env.DATABASE_URL;

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
    $disconnect: jest.fn().mockResolvedValue(),
    $connect: jest.fn().mockResolvedValue(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    flush: jest.fn().mockResolvedValue(),
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
  };

  beforeAll(() => {
    process.env.DATABASE_URL =
      originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test"; // pragma: allowlist secret
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  beforeEach(async () => {
    const mockLlmPricingService = {
      calculateCost: jest.fn().mockReturnValue(0.01),
      getTokenCount: jest.fn().mockReturnValue(100),
    };

    const mockAdminVerificationService = {
      generateAndStoreCode: jest.fn().mockResolvedValue("123456"),
      verifyCode: jest.fn().mockResolvedValue(true),
      verifyAdminSession: jest
        .fn()
        .mockResolvedValue({ email: "admin@test.com", role: "admin" }),
      createAdminSession: jest.fn().mockResolvedValue("mock-session-token"),
      revokeSession: jest.fn().mockResolvedValue(true),
      isAdminSessionValid: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        WinstonModule.forRoot({
          transports: [],
        }),
      ],
      controllers: [AdminController],
      providers: [
        AdminService,
        AdminRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
        {
          provide: AdminVerificationService,
          useValue: mockAdminVerificationService,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
