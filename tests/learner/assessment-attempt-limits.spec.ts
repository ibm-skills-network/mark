/**
 * Attempt-limit guards: max attempts and the retake cooldown. Each seeds an
 * assignment with a restrictive config, drives ONE completed objective attempt
 * (deterministic grade, settles without an LLM), then asserts BOTH surfaces:
 *
 *   - the overview "Begin" button is disabled with the right reason, and
 *   - a direct deep-link to `/questions` renders the server-side ErrorModal.
 *
 * Authentication: a fresh browser context per test, authenticated as a unique
 * learner email so the seeded attempt and the browser session are the SAME
 * identity (attempt ownership is per-userId) and tests stay isolated.
 *
 * IMPORTANT (verified against apps/api): the attempt-creation service throws
 * `UnprocessableEntityException` (HTTP 422) for BOTH "max attempts reached" AND
 * "in cooldown period" — the 429 documented on the controller is Swagger-only
 * and never thrown. The web `createAttempt` maps 422 -> "no more attempts" ->
 * the 422 "No more attempts available" ErrorModal. So a direct `/questions` nav
 * during cooldown actually renders the 422 max-attempts modal, NOT the 429
 * "Cooldown in effect" modal. The cooldown deep-link assertion is therefore
 * split: the overview cooldown state is fully asserted (client-side, real), and
 * the 429-modal expectation is marked fixme below with that explanation.
 */
import { test, expect } from "../helpers/fixtures";
import { createApiContext } from "../helpers/assignment-helpers";
import {
  createSeededAssignment,
  deleteSeededAssignment,
  driveAttempt,
  waitForGradingComplete,
} from "../helpers/seed";
import { defaultMathQuestion } from "../helpers/factories/question-factories";
import { mintAuthCookie } from "../helpers/auth";

function uniqueLearner(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Learner - Max attempts", () => {
  test("with numAttempts 1 and one completed attempt, the overview Begin button is disabled (maximum attempts reached)", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("max-overview");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      const seeded = await createSeededAssignment(apiContext, {
        questions: [defaultMathQuestion()],
        name: `Max Attempts Overview ${Date.now()}`,
        config: { numAttempts: 1 },
      });
      assignmentId = seeded.id;

      // Drive + settle the single allowed attempt as this learner.
      const { attemptId, gradingJobId } = await driveAttempt(apiContext, {
        assignmentId: seeded.id,
        answers: [{ kind: "choices", choices: ["4"] }],
        userId: learnerId,
      });
      await waitForGradingComplete(apiContext, {
        assignmentId: seeded.id,
        attemptId,
        gradingJobId,
        userId: learnerId,
      });

      const context = await browser.newContext({
        storageState: mintAuthCookie({
          userId: learnerId,
          role: "learner",
          assignmentId: seeded.id,
        }),
      });
      const page = await context.newPage();
      try {
        await page.goto(`/learner/${seeded.id}?lang=en`);

        const beginButtons = page.getByRole("button", { name: "Begin" });
        await expect(beginButtons.first()).toBeVisible();
        const count = await beginButtons.count();
        for (let index = 0; index < count; index++) {
          await expect(beginButtons.nth(index)).toBeDisabled();
        }
        // "Maximum attempts reached, contact the author to request more."
        await expect(
          page.getByText(/Maximum attempts reached/i).first(),
        ).toBeAttached();
        // Overview metadata should read 0 attempts left.
        await expect(page.getByText("0 attempts left")).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      if (assignmentId !== undefined) {
        await deleteSeededAssignment(apiContext, assignmentId);
      }
      await apiContext.dispose();
    }
  });

  test("direct /questions nav after max attempts renders the 422 'No more attempts available' ErrorModal", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("max-deeplink");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      const seeded = await createSeededAssignment(apiContext, {
        questions: [defaultMathQuestion()],
        name: `Max Attempts Deep Link ${Date.now()}`,
        config: { numAttempts: 1 },
      });
      assignmentId = seeded.id;

      const { attemptId, gradingJobId } = await driveAttempt(apiContext, {
        assignmentId: seeded.id,
        answers: [{ kind: "choices", choices: ["4"] }],
        userId: learnerId,
      });
      await waitForGradingComplete(apiContext, {
        assignmentId: seeded.id,
        attemptId,
        gradingJobId,
        userId: learnerId,
      });

      const context = await browser.newContext({
        storageState: mintAuthCookie({
          userId: learnerId,
          role: "learner",
          assignmentId: seeded.id,
        }),
      });
      const page = await context.newPage();
      try {
        await page.goto(`/learner/${seeded.id}/questions?lang=en`);

        // Server renders ErrorModal with headline + body for status 422.
        await expect(
          page.getByText("No more attempts available"),
        ).toBeVisible();
        await expect(
          page.getByText(
            /reached the maximum number of attempts for this assignment/i,
          ),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      if (assignmentId !== undefined) {
        await deleteSeededAssignment(apiContext, assignmentId);
      }
      await apiContext.dispose();
    }
  });
});

test.describe("Learner - Retake cooldown", () => {
  test("with attemptsBeforeCoolDown 1 and a cooldown window, the overview shows a cooldown 'please wait' state", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("cooldown-overview");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      // numAttempts > 1 so attempts ARE left (cooldown only shows when
      // attemptsLeft !== 0), but attemptsBeforeCoolDown 1 + a non-zero cooldown
      // means a retake right after the first attempt is gated by the cooldown.
      const seeded = await createSeededAssignment(apiContext, {
        questions: [defaultMathQuestion()],
        name: `Cooldown Overview ${Date.now()}`,
        config: {
          numAttempts: 3,
          attemptsBeforeCoolDown: 1,
          retakeAttemptCoolDownMinutes: 60,
          // Arm the attempt with an expiry so the client cooldown countdown has
          // a finish time to anchor to (it uses expiresAt/updatedAt).
          allotedTimeMinutes: 30,
        },
      });
      assignmentId = seeded.id;

      const { attemptId, gradingJobId } = await driveAttempt(apiContext, {
        assignmentId: seeded.id,
        answers: [{ kind: "choices", choices: ["4"] }],
        userId: learnerId,
      });
      await waitForGradingComplete(apiContext, {
        assignmentId: seeded.id,
        attemptId,
        gradingJobId,
        userId: learnerId,
      });

      const context = await browser.newContext({
        storageState: mintAuthCookie({
          userId: learnerId,
          role: "learner",
          assignmentId: seeded.id,
        }),
      });
      const page = await context.newPage();
      try {
        await page.goto(`/learner/${seeded.id}?lang=en`);

        // The cooldown countdown renders "(Please wait ... before retrying)"
        // and disables Begin. The countdown text is dynamic, so match the
        // stable lead-in.
        await expect(
          page.getByText(/Please wait .* before retrying/i).first(),
        ).toBeVisible({ timeout: 15_000 });

        const beginButtons = page.getByRole("button", { name: "Begin" });
        const count = await beginButtons.count();
        for (let index = 0; index < count; index++) {
          await expect(beginButtons.nth(index)).toBeDisabled();
        }
      } finally {
        await context.close();
      }
    } finally {
      if (assignmentId !== undefined) {
        await deleteSeededAssignment(apiContext, assignmentId);
      }
      await apiContext.dispose();
    }
  });

  // The task asks for the 429 "Cooldown in effect" ErrorModal on direct nav.
  // Verified against apps/api: attempt creation throws UnprocessableEntityException
  // (422) for cooldown, never 429, so the web maps it to the 422 "No more
  // attempts available" modal and the 429 branch is unreachable. This test
  // documents the intended behavior and is skipped until the api distinguishes
  // cooldown (429) from max-attempts (422). The reachable 422 path during
  // cooldown is covered by the assertion below.
  test.fixme(
    "direct /questions nav during cooldown renders the 429 'Cooldown in effect' ErrorModal",
    async () => {
      // Blocked: api returns 422 (UnprocessableEntityException) for cooldown,
      // not 429, so the web never reaches the "in cooldown period" -> 429 modal
      // branch. Enable once the api throws a distinct 429 for the cooldown case.
    },
  );

  test("direct /questions nav during cooldown currently renders the 422 attempts ErrorModal (api returns 422 for cooldown)", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("cooldown-deeplink");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      const seeded = await createSeededAssignment(apiContext, {
        questions: [defaultMathQuestion()],
        name: `Cooldown Deep Link ${Date.now()}`,
        config: {
          numAttempts: 3,
          attemptsBeforeCoolDown: 1,
          retakeAttemptCoolDownMinutes: 60,
          allotedTimeMinutes: 30,
        },
      });
      assignmentId = seeded.id;

      const { attemptId, gradingJobId } = await driveAttempt(apiContext, {
        assignmentId: seeded.id,
        answers: [{ kind: "choices", choices: ["4"] }],
        userId: learnerId,
      });
      await waitForGradingComplete(apiContext, {
        assignmentId: seeded.id,
        attemptId,
        gradingJobId,
        userId: learnerId,
      });

      const context = await browser.newContext({
        storageState: mintAuthCookie({
          userId: learnerId,
          role: "learner",
          assignmentId: seeded.id,
        }),
      });
      const page = await context.newPage();
      try {
        await page.goto(`/learner/${seeded.id}/questions?lang=en`);

        // Because the api returns 422 for cooldown, the web renders the
        // 422 "No more attempts available" ErrorModal here (see file header).
        await expect(
          page.getByText("No more attempts available"),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      if (assignmentId !== undefined) {
        await deleteSeededAssignment(apiContext, assignmentId);
      }
      await apiContext.dispose();
    }
  });
});
