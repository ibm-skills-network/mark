/**
 * Question-type coverage: TRUE_FALSE (objective, deterministic grade).
 *
 * Seeds one true/false question whose answer is `true`, selects "true" in the
 * UI, submits, and asserts the deterministic full-points score.
 *
 * The TrueFalseQuestion component renders two radio inputs with stable
 * value="true"/value="false" attributes (the visible labels are translated, so
 * we select by the value attribute rather than translatable text).
 */
import { test, expect } from "../../helpers/fixtures";
import { trueFalse } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

test.use({
  freshAssignmentQuestions: [
    trueFalse({
      prompt: "The Earth orbits the Sun.",
      answer: true,
      points: 5,
    }),
  ],
});

test.describe("Question types - TRUE_FALSE", () => {
  test("correct true/false answer is graded as a perfect score", async ({
    page,
    freshAssignment,
  }) => {
    await beginAssignment(page, freshAssignment.id);

    await expect(page.getByText("The Earth orbits the Sun.")).toBeVisible();

    const trueRadio = page.locator('input[type="radio"][value="true"]');
    await trueRadio.check();
    await expect(trueRadio).toBeChecked();

    await submitAndAwaitSuccess(page, freshAssignment.id);

    await expect(page.getByText("Passed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("100%").first()).toBeVisible();
    await expect(page.getByText(/Final Score:\s*5\s*\/\s*5/)).toBeVisible();
  });
});
