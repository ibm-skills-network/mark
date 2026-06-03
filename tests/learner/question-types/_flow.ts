/**
 * Shared browser-flow helpers for the learner question-type specs.
 *
 * The core foundation (tests/helpers/*) provides API-level seeding + an
 * `apiContext`/`freshAssignment` fixture, but no browser-driven "answer the
 * assignment in the UI and wait for the SSE-driven grade" helper. These small
 * helpers fill that gap locally (per the task's "build a small local helper
 * rather than blocking" guidance) and are intentionally selector-stable:
 *   - The language modal ("Please pick one of the available languages") is
 *     dismissed exactly as learner-homepage.spec.ts does.
 *   - "Begin" navigates to /learner/:id/questions (BeginTheAssignmentButton).
 *   - Submit uses the Header's "Submit assignment" button (the seeded config is
 *     ALL_PER_PAGE, so the per-question submit button is not rendered).
 *   - We NEVER sleep: we wait on the SSE-driven URL transition to /successPage.
 */
import type { Page } from "@playwright/test";
import { expect } from "../../helpers/fixtures";

/**
 * Dismiss the "pick a language" modal if it appears. Mirrors
 * learner-homepage.spec.ts so behaviour stays consistent across specs.
 */
export async function dismissLanguageModalIfPresent(page: Page): Promise<void> {
  const modalTitle = page.getByText(
    "Please pick one of the available languages",
  );
  await modalTitle.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {
    return null;
  });

  if (!(await modalTitle.isVisible())) {
    return;
  }

  const modal = page.locator("div.fixed.inset-0.z-50").filter({
    has: modalTitle,
  });
  const confirmButton = modal.getByRole("button", { name: "Confirm" });
  if (await confirmButton.isDisabled()) {
    await modal
      .getByRole("button", { name: /Select language|English/i })
      .click();
    await page
      .locator("#dropdown-portal")
      .getByText("English", { exact: true })
      .click();
  }

  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
}

/**
 * Open the assignment overview, dismiss the language modal, click Begin, and
 * land on the questions page. Returns once the question area has rendered.
 */
export async function beginAssignment(
  page: Page,
  assignmentId: number,
): Promise<void> {
  await page.goto(`/learner/${assignmentId}?lang=en`);
  await dismissLanguageModalIfPresent(page);

  // BeginTheAssignmentButton renders "Begin" (or "Resume"); there are multiple
  // copies (mobile/desktop/footer) — click the first visible enabled one.
  const beginButton = page
    .getByRole("button", { name: /^(Begin|Resume)$/ })
    .first();
  await expect(beginButton).toBeEnabled();
  await beginButton.click();

  await expect(page).toHaveURL(
    new RegExp(`/learner/${assignmentId}/questions`),
  );

  // Wait for the question scaffold to render (each question is in a section
  // with a "Question N" heading).
  await expect(page.getByText(/^Question 1$/).first()).toBeVisible();
}

/**
 * Click the Header "Submit assignment" button and wait for the async,
 * SSE-driven transition to the success page. Never sleeps.
 */
export async function submitAndAwaitSuccess(
  page: Page,
  assignmentId: number,
): Promise<void> {
  const submitButton = page
    .getByRole("button", { name: /^Submit assignment$/i })
    .first();
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();

  // If a required/flagged-question warning appears, confirm submission. (When
  // every question is answered this never shows; the fallback keeps the helper
  // reusable.)
  const confirm = page.getByRole("button", { name: "Confirm" });
  if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await confirm.click();
  }

  // The grading modal mounts immediately; grading is async (objective types
  // settle near-instantly, LLM types take longer). On completion the client
  // router.push()es to /successPage/:submissionId. Wait on that real
  // transition rather than any fixed delay.
  await expect(page).toHaveURL(
    new RegExp(`/learner/${assignmentId}/successPage/`),
    { timeout: 120_000 },
  );
}
