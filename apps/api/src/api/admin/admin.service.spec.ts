import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL =
      originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test";
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        PrismaService,
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
