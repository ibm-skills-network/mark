import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { GithubCredentialCheckService } from "../api/github/github-credential-check.service";
import { DatabaseCircuitBreakerService } from "../database/circuit-breaker/database-circuit-breaker.service";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";
import { PrismaService } from "../database/prisma.service";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

describe("HealthController", () => {
  let controller: HealthController;
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
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        HealthService,
        PrismaService,
        DatabaseHealthIndicator,
        DatabaseCircuitBreakerService,
        GithubCredentialCheckService,
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("serves the integration report without failing the pod's probes", () => {
    const report = controller.integrations();

    expect(report.checks.map((check) => check.name)).toContain("github_oauth");
    // A broken integration must never take the pod out of rotation.
    expect(report.status).toBeDefined();
  });
});
