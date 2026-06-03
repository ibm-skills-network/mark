/**
 * Time-limit expiry: a strict, short-timed attempt whose countdown reaches 0
 * must auto-submit and land on the success page — without a real-time wait.
 *
 * Verified against apps/web:
 *   - The attempt's `expiresAt` is computed server-side at creation as
 *     `now + allotedTimeMinutes * 60_000` (allotedTimeMinutes is an integer, so
 *     the smallest real window is 1 minute).
 *   - `use-countdown` drives off `Date.now()` + `setInterval(1000)`, and on
 *     `timerExpired` the Timer toasts
 *     "Time's up! Your responses have been saved and will be graded
 *     automatically." then, after a 2s timeout, auto-submits and
 *     `router.push("/learner/[id]/successPage/[submissionId]")`.
 *
 * To avoid a fixed/real sleep we drive Playwright's fake clock: install it just
 * before navigation (so the browser clock ≈ the server clock used for
 * expiresAt), then fast-forward past the 1-minute window AND the 2s submit
 * delay. The seeded question is OBJECTIVE so the submit settles deterministically
 * (no LLM). We assert on the real SSE/redirect-driven success URL, never a sleep.
 */
import { test, expect } from "../helpers/fixtures";
import { createApiContext } from "../helpers/assignment-helpers";
import {
  createSeededAssignment,
  deleteSeededAssignment,
} from "../helpers/seed";
import { defaultMathQuestion } from "../helpers/factories/question-factories";
import { mintAuthCookie } from "../helpers/auth";

function uniqueLearner(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Learner - Time limit expiry", () => {
  test("a strict 1-minute attempt auto-submits to the success page when the timer hits zero", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("timelimit");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      const seeded = await createSeededAssignment(apiContext, {
        questions: [defaultMathQuestion()],
        name: `Time Limit ${Date.now()}`,
        config: {
          strictTimeLimit: true,
          allotedTimeMinutes: 1,
          numAttempts: 3,
        },
      });
      assignmentId = seeded.id;

      const context = await browser.newContext({
        storageState: mintAuthCookie({
          userId: learnerId,
          role: "learner",
          assignmentId: seeded.id,
        }),
      });
      const page = await context.newPage();
      try {
        // Anchor the fake clock to real now so the browser countdown and the
        // server-computed expiresAt (real now + 60s) start aligned.
        await page.clock.install({ time: new Date() });

        await page.goto(`/learner/${seeded.id}/questions?lang=en`);

        // The timer is armed and counting (strictTimeLimit + allotedTime).
        await expect(page.getByText("Time Remaining:")).toBeVisible();

        // Fast-forward past the 1-minute window so use-countdown fires
        // `timerExpired`. 70s comfortably clears the 60s expiry plus interval
        // granularity.
        await page.clock.fastForward(70_000);

        // "Time's up!" toast confirms the expiry path engaged.
        await expect(page.getByText(/Time's up!/i)).toBeVisible({
          timeout: 15_000,
        });

        // Auto-submit waits 2s (setTimeout, also on the fake clock) before
        // submitting; advance past it to let the submit fire.
        await page.clock.fastForward(3_000);

        // The objective attempt settles deterministically and redirects to the
        // success page. Wait on the real URL transition, never a sleep.
        await expect(page).toHaveURL(/\/successPage\//, { timeout: 30_000 });
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
