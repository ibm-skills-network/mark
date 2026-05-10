import { Test, TestingModule } from "@nestjs/testing";
import { JobsAppModule } from "./app.module";
import { JobWorkerService } from "./job-worker.service";

import { PrismaService } from "../../api/src/database/prisma.service";
import { JobWorkerConnectionService } from "../../api/src/job-queue/job-worker-connection.service";
import { JobExecutorService } from "../../api/src/job-queue/job-executor.service";

import { AssignmentServiceV1 } from "../../api/src/api/assignment/v1/services/assignment.service";
import { AssignmentServiceV2 } from "../../api/src/api/assignment/v2/services/assignment.service";
import { QuestionService as AssignmentQuestionServiceV2 } from "../../api/src/api/assignment/v2/services/question.service";
import { AttemptServiceV2 } from "../../api/src/api/attempt/services/attempt.service";
import { TRANSLATION_MAINTENANCE_JOB_RUNNER } from "../../api/src/api/admin/controllers/translation-maintenance.job-runner";

describe("JobsAppModule (DI smoke test)", () => {
  const originalEnableTranslation = process.env.ENABLE_TRANSLATION;
  const originalEnableLtiScheduler = process.env.ENABLE_LTI_SCHEDULER;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  let app: TestingModule;

  beforeAll(async () => {
    process.env.ENABLE_TRANSLATION = "true";
    process.env.ENABLE_LTI_SCHEDULER = "false";
    if (!process.env.DATABASE_URL) {
      // Placeholder URL — Prisma's URL parser is invoked at module init even
      // though PrismaService is overridden with an empty stub below, so a
      // syntactically valid postgres URL is required to avoid a parse error.
      // The connection itself is never opened.
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test"; // pragma: allowlist secret
    }

    app = await Test.createTestingModule({
      imports: [JobsAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(JobWorkerConnectionService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await app.close();

    if (originalEnableTranslation === undefined) {
      delete process.env.ENABLE_TRANSLATION;
    } else {
      process.env.ENABLE_TRANSLATION = originalEnableTranslation;
    }
    if (originalEnableLtiScheduler === undefined) {
      delete process.env.ENABLE_LTI_SCHEDULER;
    } else {
      process.env.ENABLE_LTI_SCHEDULER = originalEnableLtiScheduler;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("resolves JobExecutorService", () => {
    expect(app.get(JobExecutorService)).toBeDefined();
  });

  it("resolves AssignmentServiceV1", () => {
    expect(app.get(AssignmentServiceV1)).toBeDefined();
  });

  it("resolves AssignmentServiceV2", () => {
    expect(app.get(AssignmentServiceV2)).toBeDefined();
  });

  it("resolves AssignmentQuestionServiceV2", () => {
    expect(app.get(AssignmentQuestionServiceV2)).toBeDefined();
  });

  it("resolves AttemptServiceV2", () => {
    expect(app.get(AttemptServiceV2)).toBeDefined();
  });

  it("resolves TRANSLATION_MAINTENANCE_JOB_RUNNER", () => {
    expect(app.get(TRANSLATION_MAINTENANCE_JOB_RUNNER)).toBeDefined();
  });

  it("resolves JobWorkerService", () => {
    expect(app.get(JobWorkerService)).toBeDefined();
  });
});
