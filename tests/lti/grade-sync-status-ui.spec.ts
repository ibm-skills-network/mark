/**
 * Grade-sync status UI (GradeSyncStatus.tsx) on the learner success page.
 *
 * The success page renders <GradeSyncStatus/>, which fetches
 *   GET /api/v2/assignments/:assignmentId/attempts/:attemptId/grade-sync-status
 * and maps the LTI sync `status` to learner-facing copy. We seed a REAL
 * completed objective attempt (so the success page loads with role=learner and a
 * non-NaN grade — the condition under which GradeSyncStatus is mounted), perform
 * an LTI launch as that learner, then `page.route`-stub ONLY the
 * grade-sync-status endpoint to return each status in turn, asserting the copy.
 *
 * The asserted strings are the GROUND TRUTH from apps/web/components/
 * GradeSyncStatus.tsx — note SCHEDULED and FAILED share the same headline
 * ("Your completion is safely recorded with us") and differ only in the detail
 * paragraph, so we disambiguate on the detail text.
 */
import { expect, test } from "@playwright/test";
import { createApiContext } from "../helpers/assignment-helpers";
import { seedCompletedAttempt } from "../helpers/seed";
import { singleCorrect } from "../helpers/factories/question-factories";
import { performLtiLaunch } from "../helpers/lti/mock-lti";

const LEARNER_EMAIL = "learner@example.com";

// Exact copy from GradeSyncStatus.tsx — keep in lockstep with the component.
const COPY = {
  SUCCESS: "Your completion has been synced to your course platform",
  SYNCING: "Syncing your completion to your course platform...",
  SAFELY_RECORDED: "Your completion is safely recorded with us",
  SCHEDULED_DETAIL: /It may take as long as 4–6 hours/i,
  FAILED_DETAIL: /If it hasn't appeared in your course within 24 hours/i,
} as const;

type SyncStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCESS"
  | "FAILED"
  | "SCHEDULED";

function syncStatusBody(status: SyncStatus) {
  return {
    id: 1,
    status,
    grade: 1,
    retryCount: status === "SCHEDULED" || status === "FAILED" ? 1 : 0,
    maxRetries: 9,
    lastError:
      status === "FAILED" || status === "SCHEDULED"
        ? "Upstream LMS returned 503"
        : null,
    nextRetryAt:
      status === "SCHEDULED"
        ? new Date(Date.now() + 3_600_000).toISOString()
        : null,
    completedAt: status === "SUCCESS" ? new Date().toISOString() : null,
    canRetry: status !== "SUCCESS",
  };
}

test.describe("LTI - grade-sync status UI", () => {
  // One real completed objective attempt is reused across the status variants
  // (the grade-sync-status response is stubbed per test, so the attempt's own
  // sync state is irrelevant — only that the success page renders for it).
  let assignmentId: number;
  let attemptId: number;

  test.beforeAll(async () => {
    const ctx = await createApiContext();
    try {
      const seeded = await seedCompletedAttempt(ctx, {
        questions: [
          singleCorrect({
            prompt: "What is 2 + 2?",
            choices: ["3", "4", "5"],
            correctIndex: 1,
            points: 10,
          }),
        ],
        answers: [{ kind: "choices", choices: ["4"] }],
        userId: LEARNER_EMAIL,
        name: `LTI grade-sync UI ${Date.now()}`,
      });
      assignmentId = seeded.assignmentId;
      attemptId = seeded.attemptId;
      expect(seeded.grading.status).toBe("Completed");
    } finally {
      await ctx.dispose();
    }
  });

  async function openSuccessPageWithSyncStatus(
    browser: import("@playwright/test").Browser,
    status: SyncStatus,
  ) {
    const context = await browser.newContext();
    await performLtiLaunch(context, {
      userId: LEARNER_EMAIL,
      role: "learner",
      assignmentId,
      gradingCallbackRequired: true,
    });
    const page = await context.newPage();

    // Stub ONLY the grade-sync-status fetch; everything else hits the real stack.
    await page.route("**/grade-sync-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncStatusBody(status)),
      });
    });

    await page.goto(`/learner/${assignmentId}/successPage/${attemptId}`);
    return { context, page };
  }

  test("SUCCESS → 'synced to your course platform'", async ({ browser }) => {
    const { context, page } = await openSuccessPageWithSyncStatus(
      browser,
      "SUCCESS",
    );
    try {
      await expect(page.getByText(COPY.SUCCESS)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await context.close();
    }
  });

  test("IN_PROGRESS → 'Syncing your completion...'", async ({ browser }) => {
    const { context, page } = await openSuccessPageWithSyncStatus(
      browser,
      "IN_PROGRESS",
    );
    try {
      await expect(page.getByText(COPY.SYNCING)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await context.close();
    }
  });

  test("PENDING → 'Syncing your completion...'", async ({ browser }) => {
    const { context, page } = await openSuccessPageWithSyncStatus(
      browser,
      "PENDING",
    );
    try {
      await expect(page.getByText(COPY.SYNCING)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await context.close();
    }
  });

  test("SCHEDULED → 'safely recorded' + retry-window detail", async ({
    browser,
  }) => {
    const { context, page } = await openSuccessPageWithSyncStatus(
      browser,
      "SCHEDULED",
    );
    try {
      await expect(page.getByText(COPY.SAFELY_RECORDED)).toBeVisible({
        timeout: 20_000,
      });
      // Disambiguate from FAILED (same headline) via the SCHEDULED-only detail.
      await expect(page.getByText(COPY.SCHEDULED_DETAIL)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("FAILED → 'safely recorded' + 24-hour detail", async ({ browser }) => {
    const { context, page } = await openSuccessPageWithSyncStatus(
      browser,
      "FAILED",
    );
    try {
      await expect(page.getByText(COPY.SAFELY_RECORDED)).toBeVisible({
        timeout: 20_000,
      });
      // Disambiguate from SCHEDULED (same headline) via the FAILED-only detail.
      await expect(page.getByText(COPY.FAILED_DETAIL)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("no sync record (null) → GradeSyncStatus renders nothing", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await performLtiLaunch(context, {
      userId: LEARNER_EMAIL,
      role: "learner",
      assignmentId,
      gradingCallbackRequired: true,
    });
    const page = await context.newPage();
    // The api returns `null` when there is no sync record; the component then
    // renders nothing. Stub that and assert neither headline appears.
    await page.route("**/grade-sync-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    });
    try {
      await page.goto(`/learner/${assignmentId}/successPage/${attemptId}`);
      // Give the success page time to settle (grade circle present), then assert
      // the sync card is absent.
      await expect(page.getByText(/Final Score:/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(COPY.SUCCESS)).toHaveCount(0);
      await expect(page.getByText(COPY.SAFELY_RECORDED)).toHaveCount(0);
      await expect(page.getByText(COPY.SYNCING)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
