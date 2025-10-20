import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseCircuitBreakerService } from "../database/circuit-breaker/database-circuit-breaker.service";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";
import { PrismaService } from "../database/prisma.service";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  let controller: HealthController;
  const originalDatabaseUrl = process.env.DATABASE_URL;

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        HealthService,
        PrismaService,
        DatabaseHealthIndicator,
        DatabaseCircuitBreakerService,
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
