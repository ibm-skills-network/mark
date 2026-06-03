/**
 * Question-type coverage: TEXT / essay (OPEN, LLM-graded).
 *
 * Open types are graded by a REAL LLM and there is NO e2e fake-LLM stub in this
 * codebase (grading needs OPENAI_API_KEY / WATSONX_AI_API_KEY — see
 * apps/api/.env.template; the grading feature has no E2E stub path). Therefore:
 *   - We assert STRUCTURE ONLY (the grading loop completes + the success page /
 *     feedback structure renders) — never an exact score value.
 *   - The test is marked test.fixme because in a key-less CI environment the
 *     LLM grade FAILS and the client never transitions to /successPage, which
 *     would make this flap. Flip the fixme off once an LLM key OR an
 *     E2E_FAKE_LLM stub is wired into the e2e harness.
 *
 * TODO(open-type-grading): enable by either (a) providing a grading API key to
 * the api `start:e2e` env, or (b) adding an E2E_FAKE_LLM deterministic stub to
 * the core foundation and asserting feedback structure.
 */
import { test, expect } from "../../helpers/fixtures";
import { textQuestion } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

test.use({
  freshAssignmentQuestions: [
    textQuestion({
      prompt:
        "In one or two sentences, explain what a variable is in programming.",
      responseType: "ESSAY",
      points: 10,
      maxWords: 200,
    }),
  ],
});

test.describe("Question types - TEXT (essay)", () => {
  test.fixme(
    "typed essay answer runs the grading loop and renders feedback structure",
    async ({ page, freshAssignment }) => {
      await beginAssignment(page, freshAssignment.id);

      await expect(
        page.getByText(
          "In one or two sentences, explain what a variable is in programming.",
        ),
      ).toBeVisible();

      // The essay editor is a Quill contenteditable surface (.ql-editor).
      const editor = page.locator(".ql-editor").first();
      await editor.click();
      await editor.fill(
        "A variable is a named storage location that holds a value which can be read and changed while a program runs.",
      );

      // Wait for the SSE-driven grading loop to complete (structure only — we
      // do NOT assert the score value for LLM-graded types).
      await submitAndAwaitSuccess(page, freshAssignment.id);

      // Feedback STRUCTURE renders: the question is shown back on the success
      // page (showQuestions=true) and the score scaffold is present. We assert
      // the structure exists, NOT the numeric value.
      await expect(
        page.getByText(
          "In one or two sentences, explain what a variable is in programming.",
        ),
      ).toBeVisible();
      await expect(page.getByText(/Final Score:/)).toBeVisible();
      await expect(page.getByText(/Required passing grade:/)).toBeVisible();
    },
  );
});
