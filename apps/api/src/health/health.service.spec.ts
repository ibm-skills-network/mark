import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { GithubCredentialCheckService } from "../api/github/github-credential-check.service";
import { DatabaseCircuitBreakerService } from "../database/circuit-breaker/database-circuit-breaker.service";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";
import { PrismaService } from "../database/prisma.service";
import { HealthService } from "./health.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

describe("HealthService", () => {
  let service: HealthService;
  let module: TestingModule;
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
    module = await Test.createTestingModule({
      providers: [
        HealthService,
        PrismaService,
        DatabaseHealthIndicator,
        DatabaseCircuitBreakerService,
        GithubCredentialCheckService,
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
      imports: [TerminusModule],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("checkIntegrations", () => {
    it("reports GitHub OAuth as degraded when the credential pair is rejected", () => {
      jest
        .spyOn(
          module.get<GithubCredentialCheckService>(
            GithubCredentialCheckService,
          ),
          "getStatus",
        )
        .mockReturnValue({
          state: "misconfigured",
          checkedAt: "2026-09-12T00:00:00.000Z",
        });

      const report = service.checkIntegrations();

      expect(report.status).toBe("degraded");
      expect(report.checks).toEqual([
        {
          name: "github_oauth",
          state: "misconfigured",
          checkedAt: "2026-09-12T00:00:00.000Z",
        },
      ]);
    });

    it("reports ok once the credential pair is accepted", () => {
      jest
        .spyOn(
          module.get<GithubCredentialCheckService>(
            GithubCredentialCheckService,
          ),
          "getStatus",
        )
        .mockReturnValue({
          state: "ok",
          checkedAt: "2026-09-12T00:00:00.000Z",
        });

      expect(service.checkIntegrations().status).toBe("ok");
    });
  });
});
