import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { GithubCredentialCheckService } from "../api/github/github-credential-check.service";
import { AdminGuard } from "../auth/guards/admin.guard";
import { AdminVerificationService } from "../auth/services/admin-verification.service";
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
        // The integration report is admin-gated, so Nest instantiates the
        // guard; the token check itself is covered by the guard's own spec.
        {
          provide: AdminVerificationService,
          useValue: { verifyAdminSession: jest.fn().mockResolvedValue(null) },
        },
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

  describe("access gating", () => {
    const guardsOn = (handler: unknown): unknown[] =>
      (Reflect.getMetadata("__guards__", handler as object) ?? []) as unknown[];

    const handler = (name: string): unknown =>
      (HealthController.prototype as unknown as Record<string, unknown>)[name];

    // The ingress routes `/` to this app, so excluding the route from the API
    // prefix is a routing decision, not a network boundary. Which integration
    // is broken, and since when, is operator detail — gate it.
    it("requires admin authentication for the integration report", () => {
      expect(guardsOn(handler("integrations"))).toContain(AdminGuard);
    });

    // The orchestrator cannot present credentials, so gating these would take
    // every pod out of rotation.
    it("leaves the orchestrator probes open", () => {
      expect(guardsOn(handler("liveness"))).toHaveLength(0);
      expect(guardsOn(handler("readiness"))).toHaveLength(0);
      expect(guardsOn(HealthController)).toHaveLength(0);
    });
  });
});
