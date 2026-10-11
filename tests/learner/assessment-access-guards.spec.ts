/**
 * Access guards for the learner assignment overview + the direct `/questions`
 * deep-link. These assert the SERVER-enforced and CLIENT-rendered guards that
 * stop a learner from starting an assignment they shouldn't:
 *
 *  - unpublished assignment  -> overview "Begin" disabled, "not published yet"
 *  - wrong-group assignment   -> 403 -> AccessRestricted notice
 *  - expired cookie           -> 401 -> SessionExpired notice
 *
 * These use a per-context minted cookie (helpers/auth.ts) so we can authenticate
 * as the canonical learner OR as a deliberately-invalid identity, independent of
 * the project's default learner.json storageState.
 *
 * NOTE on cookie override: the `learner-*` project ships a default
 * `storageState` (learner.json). To assert negative-auth we create a brand-new
 * browser context WITHOUT that storageState and attach our own cookie, so the
 * minted (expired / forged) identity is the only one in play.
 */
import { test, expect } from "../helpers/fixtures";
import {
  createApiContext,
  getTestEnvironmentConfig,
} from "../helpers/assignment-helpers";
import { deleteSeededAssignment } from "../helpers/seed";
import { defaultMathQuestion } from "../helpers/factories/question-factories";
import { mintAuthCookie, negativeAuth } from "../helpers/auth";

const config = getTestEnvironmentConfig();

test.describe("Learner - Access guards", () => {
  // The overview "Begin" button is gated client-side. The default learner
  // storageState already authenticates us as the canonical learner, so the
  // happy path here uses the project default; the negative-auth cases below
  // build their own cookie-less contexts.

  test("unpublished assignment shows a disabled Begin button with a 'not published' reason", async ({
    page,
  }) => {
    // Create an assignment but DO NOT publish it. createSeededAssignment
    // auto-publishes via the /content endpoint, so for the unpublished case we
    // create the bare assignment (no content) directly: it has no published
    // version, which is exactly the "not-published" learner state.
    const apiContext = await createApiContext(config);
    let assignmentId: number | undefined;
    try {
      const response = await apiContext.post("/api/v1/admin/assignments", {
        data: {
          name: `Unpublished Assignment ${Date.now()}`,
          type: config.assignmentType,
          groupId: config.groupId,
        },
        headers: {
          "user-session": JSON.stringify({
            userId: config.adminEmail,
            role: "admin",
            groupId: config.groupId,
            assignmentId: 0,
          }),
        },
      });
      expect(
        response.ok(),
        `failed to create bare assignment: ${response.status()}`,
      ).toBeTruthy();
      assignmentId = ((await response.json()) as { id: number }).id;

      await page.goto(`/learner/${assignmentId}?lang=en`);

      // The Begin button is disabled and its tooltip explains why. There are
      // multiple Begin buttons (responsive variants); every one must be
      // disabled, and the not-published reason must be present in the DOM.
      const beginButtons = page.getByRole("button", { name: "Begin" });
      await expect(beginButtons.first()).toBeVisible();
      const count = await beginButtons.count();
      for (let index = 0; index < count; index++) {
        await expect(beginButtons.nth(index)).toBeDisabled();
      }
      await expect(
        page.getByText("The assignment is not published yet.").first(),
      ).toBeAttached();
    } finally {
      if (assignmentId !== undefined) {
        await deleteSeededAssignment(apiContext, assignmentId);
      }
      await apiContext.dispose();
    }
  });

  test("assignment in a different group is blocked with the AccessRestricted notice (403)", async ({
    browser,
    seedAssignment,
  }) => {
    // Seed a published assignment in a DIFFERENT group than the learner's
    // cookie (pw-group). The attempt access-control guard returns false when
    // there's no assignment<->group link for the caller's group -> 403.
    const otherGroupId = `pw-other-group-${Date.now()}`;
    const seeded = await seedAssignment({
      questions: [defaultMathQuestion()],
      name: `Wrong Group Assignment ${Date.now()}`,
      groupId: otherGroupId,
    });

    // A clean context (no default learner.json), authenticated as the canonical
    // learner in pw-group — so the learner is valid but NOT a member of the
    // assignment's group.
    const context = await browser.newContext({
      storageState: mintAuthCookie({
        userId: "learner@example.com",
        role: "learner",
        groupId: config.groupId,
        assignmentId: seeded.id,
      }),
    });
    const page = await context.newPage();
    try {
      await page.goto(`/learner/${seeded.id}?lang=en`);

      // 403 -> AccessRestricted. Match on the stable notice heading text.
      await expect(
        page.getByText("You don’t have access to this assignment"),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("expired cookie shows the SessionExpired notice (401)", async ({
    browser,
    freshAssignment,
  }) => {
    // A valid-signature, already-expired token -> gateway rejects with 401 ->
    // getUser throws Unauthorized -> SessionExpired.
    const context = await browser.newContext({
      storageState: negativeAuth.expired({
        userId: "learner@example.com",
        role: "learner",
        groupId: config.groupId,
        assignmentId: freshAssignment.id,
      }),
    });
    const page = await context.newPage();
    try {
      await page.goto(`/learner/${freshAssignment.id}?lang=en`);

      await expect(page.getByText("Your session has expired")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("forged-signature cookie shows the SessionExpired notice (401)", async ({
    browser,
    freshAssignment,
  }) => {
    // A token signed with the wrong secret -> bad signature -> 401, same
    // SessionExpired surface as an expired token.
    const context = await browser.newContext({
      storageState: negativeAuth.forged({
        userId: "learner@example.com",
        role: "learner",
        groupId: config.groupId,
        assignmentId: freshAssignment.id,
      }),
    });
    const page = await context.newPage();
    try {
      await page.goto(`/learner/${freshAssignment.id}?lang=en`);

      await expect(page.getByText("Your session has expired")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
