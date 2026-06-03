/**
 * Question-type coverage: MULTIPLE_CORRECT (objective, deterministic grade).
 *
 * Seeds one multiple-correct question, selects every correct choice (and no
 * incorrect ones) in the UI, submits, and asserts the deterministic full-points
 * score on the success page.
 */
import { test, expect } from "../../helpers/fixtures";
import { multipleCorrect } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

const CHOICES = ["Mercury", "Venus", "Earth", "Jupiter"];
// Inner planets among the options: Mercury, Venus, Earth.
const CORRECT_INDEXES = [0, 1, 2];

test.use({
  freshAssignmentQuestions: [
    multipleCorrect({
      prompt: "Select all of the inner planets.",
      choices: CHOICES,
      correctIndexes: CORRECT_INDEXES,
      points: 12,
    }),
  ],
});

test.describe("Question types - MULTIPLE_CORRECT", () => {
  test("selecting all correct choices yields full points", async ({
    page,
    freshAssignment,
  }) => {
    await beginAssignment(page, freshAssignment.id);

    await expect(
      page.getByText("Select all of the inner planets."),
    ).toBeVisible();

    for (const index of CORRECT_INDEXES) {
      await page
        .getByRole("button", { name: CHOICES[index], exact: true })
        .click();
    }

    await submitAndAwaitSuccess(page, freshAssignment.id);

    // All correct choices selected, none incorrect => full points => 100%.
    await expect(page.getByText("Passed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("100%").first()).toBeVisible();
    await expect(page.getByText(/Final Score:\s*12\s*\/\s*12/)).toBeVisible();
  });
});
