import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseCircuitBreakerService } from "../database/circuit-breaker/database-circuit-breaker.service";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";
import { PrismaService } from "../database/prisma.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        PrismaService,
        DatabaseHealthIndicator,
        DatabaseCircuitBreakerService,
      ],
      imports: [TerminusModule],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
