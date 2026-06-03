/**
 * Question-type coverage: URL (OPEN, LLM-graded).
 *
 * As with TEXT, URL responses are graded by a real LLM and there is no e2e
 * fake-LLM stub. We assert STRUCTURE ONLY (loop completes + success page
 * renders), never a score value, and mark the test test.fixme so a key-less CI
 * environment (where the grade fails and never reaches /successPage) does not
 * flap.
 *
 * TODO(open-type-grading): enable once a grading API key OR an E2E_FAKE_LLM
 * stub is wired into the e2e harness.
 *
 * The URL input is a plain text <input> with placeholder "Enter website URL".
 * The submit button stays disabled while the URL is invalid
 * (getSubmitButtonStatus), so we fill a syntactically valid URL.
 */
import { test, expect } from "../../helpers/fixtures";
import { urlQuestion } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

test.use({
  freshAssignmentQuestions: [
    urlQuestion({
      prompt: "Share a link to your project repository.",
      responseType: "REPORT",
      points: 8,
    }),
  ],
});

test.describe("Question types - URL", () => {
  test.fixme(
    "valid url submission runs the grading loop to completion",
    async ({ page, freshAssignment }) => {
      await beginAssignment(page, freshAssignment.id);

      await expect(
        page.getByText("Share a link to your project repository."),
      ).toBeVisible();

      const urlInput = page.getByPlaceholder("Enter website URL");
      await urlInput.fill("https://example.com/my-project");

      await submitAndAwaitSuccess(page, freshAssignment.id);

      // Structure only: the success page renders the score scaffold and the
      // question. No numeric-value assertion for an LLM-graded type.
      await expect(
        page.getByText("Share a link to your project repository."),
      ).toBeVisible();
      await expect(page.getByText(/Final Score:/)).toBeVisible();
    },
  );
});
