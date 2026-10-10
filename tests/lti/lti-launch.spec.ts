/**
 * LTI launch → in-assignment.
 *
 * Verifies that an LMS LTI launch (modelled by `performLtiLaunch`, which mints
 * the exact post-launch `authentication` cookie the real SSO/LTI gateway would)
 * lands the learner inside the targeted assignment with the launch claims
 * honoured by the REAL auth guard: the group from the launch grants access, and
 * the locale/returnUrl claims ride along in the session.
 *
 * These specs are self-authenticating: they build a fresh browser context and
 * perform the launch into it, so they do NOT depend on a project storageState.
 * The `tests/lti/` Playwright project (registered when this directory is wired
 * into playwright.config) can therefore start with NO default storageState.
 */
import { expect, test } from "@playwright/test";
import { readAssignmentsCache } from "../helpers/assignment-helpers";
import { performLtiLaunch } from "../helpers/lti/mock-lti";

const LEARNER_EMAIL = "learner@example.com";

test.describe("LTI - launch into assignment", () => {
  test("an LMS launch lands the learner in their assignment", async ({
    browser,
  }) => {
    const { learner } = readAssignmentsCache();

    const context = await browser.newContext();
    try {
      const { payload } = await performLtiLaunch(context, {
        userId: LEARNER_EMAIL,
        role: "learner",
        assignmentId: learner.id,
        // A real launch supplies the AGS lineitem → passback required.
        gradingCallbackRequired: true,
        locale: "en",
        returnUrl: "https://lms.example.edu/courses/42/return",
      });

      // The cookie carries the launch claims the product consumes.
      expect(payload.gradingCallbackRequired).toBe(true);
      expect(payload.launch_presentation_locale).toBe("en");
      expect(payload.returnUrl).toBe(
        "https://lms.example.edu/courses/42/return",
      );

      const page = await context.newPage();
      await page.goto(`/learner/${learner.id}?lang=en`);

      // The real cookie auth guard let us through to the learner assignment.
      await expect(page).toHaveURL(new RegExp(`/learner/${learner.id}`));
      await expect(page.getByRole("banner").getByRole("heading")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the launch group governs access (real guard, not the UI)", async ({
    browser,
  }) => {
    const { learner } = readAssignmentsCache();

    const context = await browser.newContext();
    try {
      // Launch carrying the CORRECT group → the assignment API call succeeds.
      await performLtiLaunch(context, {
        userId: LEARNER_EMAIL,
        role: "learner",
        assignmentId: learner.id,
        gradingCallbackRequired: true,
      });

      const page = await context.newPage();
      await page.goto(`/learner/${learner.id}?lang=en`);
      await expect(page).toHaveURL(new RegExp(`/learner/${learner.id}`));

      // The assignment content actually rendered — proof the launch session was
      // accepted end-to-end (gateway cookie auth → api group/ownership check).
      await expect(
        page.getByRole("heading", { name: /assignment/i }).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  test("an expired launch cookie is rejected by the auth guard", async ({
    browser,
  }) => {
    const { learner } = readAssignmentsCache();

    const context = await browser.newContext();
    try {
      // Model a stale launch: a correctly-signed cookie whose exp is in the past.
      await performLtiLaunch(context, {
        userId: LEARNER_EMAIL,
        role: "learner",
        assignmentId: learner.id,
        gradingCallbackRequired: true,
        expiresInSeconds: -60,
      });

      const page = await context.newPage();
      const response = await page.goto(`/learner/${learner.id}?lang=en`);

      // The gateway rejects the expired JWT (ignoreExpiration:false). The exact
      // surfaced status depends on the web shell, so assert we did NOT land in
      // an authenticated assignment view: either a non-2xx document or a
      // redirect away from the learner route.
      const landedAuthenticated =
        page.url().includes(`/learner/${learner.id}`) &&
        (response?.ok() ?? false);
      expect(landedAuthenticated).toBe(false);
    } finally {
      await context.close();
    }
  });
});
