/**
 * Per-test assignment fixtures for Playwright E2E.
 *
 * Extends the existing worker-scoped `assignmentIds` fixture (from e2e-test.ts)
 * WITHOUT removing it, and adds test-scoped helpers so each test can own an
 * isolated, freshly-seeded assignment that is torn down afterwards. This is the
 * precondition for re-enabling parallelism (playwright.config currently forces
 * workers:1 because the legacy specs share one assignment).
 *
 * Import this `test`/`expect` in specs that need isolation:
 *   import { test, expect } from "../helpers/fixtures";
 *
 * Specs that only need the shared assignment can keep importing
 * "../helpers/e2e-test" — both expose the same `assignmentIds`.
 *
 * Two ways to get a fresh assignment:
 *   1. `freshAssignment` — an auto-seeded assignment for the test. By default it
 *      seeds a single objective question; override the question set per file or
 *      per test with `test.use({ freshAssignmentQuestions: [...] })`.
 *   2. `seedAssignment(opts)` — a factory you call inline to create as many
 *      isolated assignments as you need; all are deleted in teardown.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import {
  createApiContext,
  readAssignmentsCache,
  type TestAssignments,
} from "./assignment-helpers";
import {
  createSeededAssignment,
  deleteSeededAssignment,
  type SeededAssignment,
} from "./seed";
import {
  defaultMathQuestion,
  type SeedQuestion,
} from "./factories/question-factories";

type SeedAssignmentOptions = {
  questions: SeedQuestion[];
  name?: string;
  type?: string;
  groupId?: string;
  config?: Record<string, unknown>;
};

type SeedAssignmentFn = (
  options: SeedAssignmentOptions,
) => Promise<SeededAssignment>;

type WorkerFixtures = {
  assignmentIds: TestAssignments;
};

type TestFixtures = {
  /**
   * Option fixture: the question set used by `freshAssignment`. Override with
   * `test.use({ freshAssignmentQuestions: [...] })` at file or describe scope.
   */
  freshAssignmentQuestions: SeedQuestion[];
  /** A Playwright APIRequestContext (direct to mark api) scoped to the test. */
  apiContext: APIRequestContext;
  /** Factory to seed additional isolated assignments; auto-deleted on teardown. */
  seedAssignment: SeedAssignmentFn;
  /** An isolated, auto-seeded+published assignment for this test. */
  freshAssignment: SeededAssignment;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Preserve the existing worker-scoped shared-assignment fixture.
  assignmentIds: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(readAssignmentsCache());
    },
    { scope: "worker" },
  ],

  // Default question set for `freshAssignment` (overridable via test.use).
  // Use the fixture-function form so each test gets a FRESH array+question
  // object: the literal-value form ([[defaultMathQuestion()], { option: true }])
  // would evaluate defaultMathQuestion() once at module load and share the same
  // object reference across every test that uses the default.
  freshAssignmentQuestions: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use([defaultMathQuestion()]);
    },
    { option: true },
  ],

  apiContext: async ({}, use) => {
    const context = await createApiContext();
    await use(context);
    await context.dispose();
  },

  seedAssignment: async ({ apiContext }, use) => {
    const created: number[] = [];

    const factory: SeedAssignmentFn = async (options) => {
      const assignment = await createSeededAssignment(apiContext, options);
      created.push(assignment.id);
      return assignment;
    };

    await use(factory);

    // Teardown: best-effort delete everything this test created.
    for (const id of created) {
      await deleteSeededAssignment(apiContext, id);
    }
  },

  freshAssignment: async ({ apiContext, freshAssignmentQuestions }, use) => {
    const assignment = await createSeededAssignment(apiContext, {
      questions: freshAssignmentQuestions,
      name: `Fresh Assignment ${Date.now()}`,
    });

    await use(assignment);

    await deleteSeededAssignment(apiContext, assignment.id);
  },
});

export { expect };
