/**
 * Required-questions gate. With `requireAllQuestions` on and >=2 questions,
 * leaving a required question blank must block submission and surface an
 * "(N unanswered)" message.
 *
 * Verified against apps/web: the gate is enforced TWICE —
 *   1. `getSubmitButtonStatus` DISABLES the Submit button while any required
 *      question is unanswered, with reason
 *      "All required questions must be answered before submitting (N unanswered)"
 *      shown in the tooltip; and
 *   2. `CheckNoFlaggedQuestions` toasts the same "(N unanswered)" message if the
 *      submit is somehow triggered.
 * Because the button is disabled (not just toasting), the stable, real assertion
 * is: Submit is disabled AND the "(1 unanswered)" reason is present in the DOM.
 * Answering the second question then re-enables Submit.
 *
 * Auth: a fresh context per test as a unique learner so the auto-created attempt
 * is owned by the browser session.
 */
import { test, expect } from "../helpers/fixtures";
import { createApiContext } from "../helpers/assignment-helpers";
import {
  createSeededAssignment,
  deleteSeededAssignment,
} from "../helpers/seed";
import { singleCorrect } from "../helpers/factories/question-factories";
import { mintAuthCookie } from "../helpers/auth";

function uniqueLearner(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Learner - Required questions gate", () => {
  test("leaving a required question blank disables Submit and shows the '(1 unanswered)' reason; answering it re-enables Submit", async ({
    browser,
  }) => {
    const learnerId = uniqueLearner("required");
    const apiContext = await createApiContext();
    let assignmentId: number | undefined;
    try {
      // Two SINGLE_CORRECT questions with DISTINCT choice texts so selectors are
      // unambiguous on an ALL_PER_PAGE page. requireAllQuestions makes both
      // required (no optionalQuestionIds seeded).
      const seeded = await createSeededAssignment(apiContext, {
        questions: [
          singleCorrect({
            prompt: "Pick the first colour.",
            choices: ["Crimson", "Cerulean", "Chartreuse"],
            correctIndex: 0,
          }),
          singleCorrect({
            prompt: "Pick the second animal.",
            choices: ["Pangolin", "Quokka", "Numbat"],
            correctIndex: 1,
          }),
        ],
        name: `Required Questions ${Date.now()}`,
        config: {
          requireAllQuestions: true,
          questionDisplay: "ALL_PER_PAGE",
          // No time limit so the timer/auto-submit never interferes.
          allotedTimeMinutes: 0,
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
        // Deep-link straight into the attempt; LearnerLayout auto-creates the
        // attempt for this learner.
        await page.goto(`/learner/${seeded.id}/questions?lang=en`);

        // Both questions render (ALL_PER_PAGE).
        await expect(page.getByText("Pick the first colour.")).toBeVisible();
        await expect(page.getByText("Pick the second animal.")).toBeVisible();

        // Answer ONLY the first question.
        await page.getByRole("button", { name: "Crimson" }).click();

        // Submit (desktop label "Submit assignment") is disabled while a
        // required question is blank, and the "(1 unanswered)" reason is in the
        // DOM as the tooltip.
        const submit = page.getByRole("button", {
          name: /Submit assignment|Submit/,
        });
        await expect(submit.first()).toBeDisabled();
        await expect(page.getByText(/\(1 unanswered\)/).first()).toBeAttached();

        // Answer the second required question -> Submit becomes enabled.
        await page.getByRole("button", { name: "Quokka" }).click();
        await expect(submit.first()).toBeEnabled();
        await expect(page.getByText(/\(1 unanswered\)/)).toHaveCount(0);
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
