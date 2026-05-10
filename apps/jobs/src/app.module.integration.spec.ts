// IMPORTANT: keep the harness import FIRST and evaluate the availability gate
// BEFORE any other import. The @prisma/client transitive import (pulled in by
// JobsAppModule -> DatabaseModule -> PrismaService) eagerly loads a generated
// dotenv shim at module-load time, which populates process.env.DATABASE_URL
// from any local .env that exists outside this workspace. Evaluating the gate
// first preserves the "no DATABASE_URL provided by CI" semantic.
import { getPostgresTestEnvironmentAvailability } from "../../../test-support/postgres-test-harness";

// This integration spec executes ATTEMPT_GRADE and ASSIGNMENT_V2_PUBLISH
// against a real Postgres test database. It is currently skipped because the
// seed fixture (Assignment 9001 / AssignmentAttempt 9002 with all required
// foreign-key + NOT NULL columns) is not yet implemented; running it against
// an empty DB would produce false confidence (executor calls would fail with
// "not found" errors that the resolves.not.toThrow assertion would mask).
// Re-enable by implementing the seed inside beforeAll.
const SEED_FIXTURE_IMPLEMENTED = false;

// Surface the skip at suite-discovery time so CI logs (and any developer
// running the suite locally) see why the integration tests are not running,
// instead of the skip being invisible behind the SEED_FIXTURE_IMPLEMENTED
// constant. Without this, the spec is functionally a permanent skip until
// somebody happens to grep for it.
if (!SEED_FIXTURE_IMPLEMENTED) {
  // eslint-disable-next-line no-console
  console.warn(
    "[app.module.integration.spec] Skipping flag-on E2E suite: seed fixture not yet implemented. Implement the Assignment/AssignmentAttempt seed inside beforeAll and flip SEED_FIXTURE_IMPLEMENTED to re-enable.",
  );
}

const postgresAvailable =
  getPostgresTestEnvironmentAvailability().available &&
  SEED_FIXTURE_IMPLEMENTED;
const describeIfPostgres = postgresAvailable ? describe : describe.skip;

import { Test, TestingModule } from "@nestjs/testing";
import { JobsAppModule } from "./app.module";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";
import { JobExecutorService } from "../../api/src/job-queue/job-executor.service";
import { PrismaService } from "../../api/src/database/prisma.service";

describeIfPostgres("JobsAppModule integration (flag-on E2E)", () => {
  const originalFlag = process.env.JOBS_EXECUTE_LOCALLY;
  const originalEnableTranslation = process.env.ENABLE_TRANSLATION;
  const originalEnableLtiScheduler = process.env.ENABLE_LTI_SCHEDULER;

  let app: TestingModule;
  let prisma: PrismaService;
  let executor: JobExecutorService;
  let fetchSpy: jest.SpyInstance;

  // Concrete fixture identifiers — adjust to match a seed-fixture pattern
  // that exists in the repo when this spec is run against a real test DB.
  const fixtureAssignmentId = 9001;
  const fixtureAttemptId = 9002;

  beforeAll(async () => {
    process.env.JOBS_EXECUTE_LOCALLY = "true";
    process.env.ENABLE_TRANSLATION = "true";
    process.env.ENABLE_LTI_SCHEDULER = "false";

    app = await Test.createTestingModule({
      imports: [JobsAppModule],
    }).compile();
    prisma = app.get(PrismaService);
    executor = app.get(JobExecutorService);
    fetchSpy = jest.spyOn(global, "fetch");

    // Minimal seed fixture rows would go here when running against a real
    // test DB; the concrete shape must satisfy whatever foreign-key and
    // NOT NULL constraints AssignmentAttempt + Question + Assignment require.
  });

  afterAll(async () => {
    try {
      await prisma.assignmentAttempt.deleteMany({
        where: { id: fixtureAttemptId },
      });
      await prisma.assignment.deleteMany({
        where: { id: fixtureAssignmentId },
      });
    } catch {
      // delete failures are non-fatal in teardown
    }

    await app.close();
    fetchSpy.mockRestore();

    if (originalFlag === undefined) delete process.env.JOBS_EXECUTE_LOCALLY;
    else process.env.JOBS_EXECUTE_LOCALLY = originalFlag;
    if (originalEnableTranslation === undefined)
      delete process.env.ENABLE_TRANSLATION;
    else process.env.ENABLE_TRANSLATION = originalEnableTranslation;
    if (originalEnableLtiScheduler === undefined)
      delete process.env.ENABLE_LTI_SCHEDULER;
    else process.env.ENABLE_LTI_SCHEDULER = originalEnableLtiScheduler;
  });

  beforeEach(() => {
    fetchSpy.mockClear();
  });

  it("executes ATTEMPT_GRADE locally without forwarding", async () => {
    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ATTEMPT,
        jobName: JOB_NAMES.ATTEMPT_GRADE,
        payload: {
          gradingJobId: "test-job-attempt",
          attemptId: fixtureAttemptId,
          assignmentId: fixtureAssignmentId,
          updateDto: {},
          userSession: {
            userId: "noahfreelove@gmail.com",
            role: "learner",
            gradingCallbackRequired: false,
          },
        },
        bullJobId: "bull-test-1",
      }),
    ).resolves.not.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();

    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { id: fixtureAttemptId },
    });
    expect(attempt).toBeDefined();
  });

  it("executes ASSIGNMENT_V2_PUBLISH locally without forwarding", async () => {
    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        jobName: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
        payload: {
          jobId: "test-job-publish",
          assignmentId: fixtureAssignmentId,
          updateDto: {},
          userId: "noahfreelove@gmail.com",
        },
        bullJobId: "bull-test-2",
      }),
    ).resolves.not.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();

    const assignment = await prisma.assignment.findUnique({
      where: { id: fixtureAssignmentId },
    });
    expect(assignment).toBeDefined();
  });
});
