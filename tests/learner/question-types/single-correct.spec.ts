/**
 * Question-type coverage: SINGLE_CORRECT (objective, deterministic grade).
 *
 * Seeds one single-correct question via the factory, answers it correctly in
 * the UI, submits, waits on the SSE-driven success-page transition, and asserts
 * the deterministic score (100% — a perfect objective answer).
 */
import { test, expect } from "../../helpers/fixtures";
import { singleCorrect } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

const CHOICES = ["Lisbon", "Madrid", "Paris", "Rome"];
const CORRECT_INDEX = 2; // "Paris"

test.use({
  freshAssignmentQuestions: [
    singleCorrect({
      prompt: "What is the capital of France?",
      choices: CHOICES,
      correctIndex: CORRECT_INDEX,
      points: 10,
    }),
  ],
});

test.describe("Question types - SINGLE_CORRECT", () => {
  test("correct single-choice answer is graded as a perfect score", async ({
    page,
    freshAssignment,
  }) => {
    await beginAssignment(page, freshAssignment.id);

    // The prompt should render.
    await expect(
      page.getByText("What is the capital of France?"),
    ).toBeVisible();

    // Choices render as buttons whose text is the choice. Pick the correct one.
    await page
      .getByRole("button", { name: CHOICES[CORRECT_INDEX], exact: true })
      .click();

    await submitAndAwaitSuccess(page, freshAssignment.id);

    // Objective grading is deterministic: a perfect answer => 100% / Passed.
    await expect(page.getByText("Passed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("100%").first()).toBeVisible();
    await expect(page.getByText(/Final Score:\s*10\s*\/\s*10/)).toBeVisible();
  });
});
