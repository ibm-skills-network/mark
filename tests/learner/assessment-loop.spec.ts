/**
 * The core assessment loop (learner role).
 *
 * Drives the highest-value, deterministic path through the product UI:
 *   land on the assignment → Begin → answer objective question(s) →
 *   Submit → grading-progress modal (SSE-driven) → successPage shows the
 *   deterministic grade / Passed-Failed / per-question feedback.
 *
 * Why OBJECTIVE questions only: SINGLE_CORRECT / MULTIPLE_CORRECT / TRUE_FALSE
 * are graded rule-based (NO LLM), so the grade VALUE is deterministic and the
 * SSE grading loop settles without an API key or stub. Open types (TEXT/URL/
 * UPLOAD) are LLM-graded and are out of scope here (see gaps in the report).
 *
 * Isolation: each test owns a freshly-seeded+published assignment via the
 * `seedAssignment`/`freshAssignment` fixtures from ../helpers/fixtures, which
 * auto-delete in teardown. The learner identity is the project storageState
 * (learner@example.com / pw-group) configured by playwright.config's
 * learner-* projects, so the seeded assignment is attemptable as that learner.
 *
 * SSE discipline: we ALWAYS wait on the real UI transition the EventSource
 * drives — `await expect(page).toHaveURL(/successPage/)` — never a fixed sleep.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import {
  singleCorrect,
  trueFalse,
  type SeedQuestion,
} from "../helpers/factories/question-factories";
import {
  driveAttempt,
  waitForGradingComplete,
  type SeededAssignment,
} from "../helpers/seed";

const SUCCESS_PAGE_URL = /\/successPage\//;

/**
 * The first-visit language modal ("Please pick one of the available languages")
 * intercepts clicks on the assignment landing page. Dismiss it if present; it is
 * benign to skip when it never appears (e.g. lang already chosen).
 */
async function dismissLanguageModalIfPresent(page: Page) {
  const modalTitle = page.getByText(
    "Please pick one of the available languages",
  );
  await modalTitle.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {
    return null;
  });

  if (!(await modalTitle.isVisible().catch(() => false))) {
    return;
  }

  const modal = page.locator("div.fixed.inset-0.z-50").filter({
    has: modalTitle,
  });
  const confirmButton = modal.getByRole("button", { name: "Confirm" });
  if (await confirmButton.isEnabled().catch(() => false)) {
    await confirmButton.click();
  }
  await modalTitle.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {
    return null;
  });
}

/**
 * Navigate to a seeded assignment's landing page and click Begin, landing on
 * the /questions attempt page with a freshly-created attempt. Returns once the
 * first question (its prompt) is visible so the test can interact with it.
 */
async function beginAssignment(
  page: Page,
  assignment: SeededAssignment,
  firstQuestionPrompt: string,
) {
  await page.goto(`/learner/${assignment.id}?lang=en`);
  await dismissLanguageModalIfPresent(page);

  // There are several "Begin" buttons (responsive duplicates); the first
  // enabled one is fine — they all link to /questions.
  await page
    .getByRole("button", { name: "Begin", exact: true })
    .first()
    .click();

  await expect(page).toHaveURL(/\/questions/, { timeout: 15_000 });
  await expect(page.getByText(firstQuestionPrompt)).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Within the question section that contains `prompt`, pick the choice whose
 * button text exactly matches `choiceText`. Choices render as <button>s
 * (MultipleChoiceQuestion), so role+name is the stable selector.
 */
async function selectChoice(page: Page, prompt: string, choiceText: string) {
  const section = page.locator("section", {
    has: page.getByText(prompt),
  });
  await section
    .getByRole("button", { name: choiceText, exact: true })
    .first()
    .click();
}

/** Click the header "Submit assignment" button (desktop) and confirm if warned. */
async function submitAssignment(page: Page) {
  const submitButton = page.getByRole("button", { name: "Submit assignment" });
  await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  await submitButton.click();

  // If any required/flagged-question warning appears, confirm submission.
  const confirm = page.getByRole("button", { name: "Confirm" });
  if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await confirm.click();
  }
}

test.describe("Learner - core assessment loop (objective, deterministic)", () => {
  test("single-choice correct answer submits, grades, and successPage shows 100% Passed", async ({
    page,
    seedAssignment,
  }) => {
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      name: `Loop single-correct ${Date.now()}`,
    });

    await beginAssignment(page, assignment, prompt);
    await selectChoice(page, prompt, "4");
    await submitAssignment(page);

    // Wait on the SSE-driven transition — never a fixed sleep.
    await expect(page).toHaveURL(SUCCESS_PAGE_URL, { timeout: 30_000 });

    await expect(page.getByText("Passed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("100%").first()).toBeVisible();
    // The deterministic score line: "Final Score: 10 / 10 (100%)".
    await expect(page.getByText(/Final Score:\s*10\s*\/\s*10/)).toBeVisible();
  });

  test("single-choice wrong answer submits, grades, and successPage shows Failed", async ({
    page,
    seedAssignment,
  }) => {
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      name: `Loop single-wrong ${Date.now()}`,
    });

    await beginAssignment(page, assignment, prompt);
    // Deliberately wrong choice.
    await selectChoice(page, prompt, "3");
    await submitAssignment(page);

    await expect(page).toHaveURL(SUCCESS_PAGE_URL, { timeout: 30_000 });

    await expect(page.getByText("Failed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // 0 / 10 → 0% is below the seeded passingGrade (60).
    await expect(page.getByText(/Final Score:\s*0\s*\/\s*10/)).toBeVisible();
  });

  test("the grading-progress modal appears on submit before the successPage transition", async ({
    page,
    seedAssignment,
  }) => {
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      name: `Loop grading-modal ${Date.now()}`,
    });

    await beginAssignment(page, assignment, prompt);
    await selectChoice(page, prompt, "4");
    await submitAssignment(page);

    // The GradingProgressModal renders one of these headings while the SSE
    // stream is open: "Grading Your Assignment" (processing) →
    // "🎉 Grading Complete!" (completed). Objective grading is fast, so accept
    // either phase — both prove the modal mounted on submit.
    const gradingHeading = page.getByRole("heading", {
      name: /Grading Your Assignment|Grading Complete/,
    });
    await expect(gradingHeading).toBeVisible({ timeout: 15_000 });

    // And it ultimately drives the SSE-completion navigation.
    await expect(page).toHaveURL(SUCCESS_PAGE_URL, { timeout: 30_000 });
  });

  test("per-question feedback renders on successPage when submission feedback is enabled", async ({
    page,
    seedAssignment,
  }) => {
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      // showSubmissionFeedback defaults to true in the seed config; set it
      // explicitly so this test documents the precondition it relies on.
      config: { showSubmissionFeedback: true, showQuestions: true },
      name: `Loop feedback ${Date.now()}`,
    });

    await beginAssignment(page, assignment, prompt);
    await selectChoice(page, prompt, "4");
    await submitAssignment(page);

    await expect(page).toHaveURL(SUCCESS_PAGE_URL, { timeout: 30_000 });

    // The question review section is rendered (showQuestions=true).
    await expect(page.getByRole("heading", { name: "Question 1" })).toBeVisible(
      { timeout: 15_000 },
    );
    // The per-question score line for the objective question.
    await expect(page.getByText(/Score:\s*10\s*\/\s*10/)).toBeVisible();
    // The factory marks the correct choice's feedback "Correct!"; with
    // showSubmissionFeedback=true the selected-choice feedback is shown.
    await expect(page.getByText("Correct!", { exact: true })).toBeVisible();
  });

  test("one-per-page display: Next/Previous navigation then last-question submit reaches successPage", async ({
    page,
    seedAssignment,
  }) => {
    const promptOne = "Is the sky blue?";
    const promptTwo = "What is 2 + 2?";
    const questions: SeedQuestion[] = [
      trueFalse({ prompt: promptOne, answer: true }),
      singleCorrect({
        prompt: promptTwo,
        choices: ["3", "4", "5"],
        correctIndex: 1,
      }),
    ];
    const assignment = await seedAssignment({
      questions,
      config: { questionDisplay: "ONE_PER_PAGE" },
      name: `Loop one-per-page ${Date.now()}`,
    });

    await beginAssignment(page, assignment, promptOne);

    // Question 1 (TRUE_FALSE): answer true. TrueFalseQuestion renders the
    // answer as a clickable control labelled "True".
    const q1Section = page.locator("section", {
      has: page.getByText(promptOne),
    });
    await q1Section.getByText("True", { exact: true }).first().click();

    // ONE_PER_PAGE shows a "Next Question" control; advancing reveals Q2.
    await page.getByRole("button", { name: "Next Question" }).click();
    await expect(page.getByText(promptTwo)).toBeVisible({ timeout: 10_000 });

    // Go back to prove Previous works, then forward again.
    await page.getByRole("button", { name: "Previous Question" }).click();
    await expect(page.getByText(promptOne)).toBeVisible();
    await page.getByRole("button", { name: "Next Question" }).click();
    await expect(page.getByText(promptTwo)).toBeVisible();

    await selectChoice(page, promptTwo, "4");

    // The last question's in-page "Submit Assignment" button dispatches the
    // submission event handled by the header.
    await page.getByRole("button", { name: "Submit Assignment" }).click();
    const confirm = page.getByRole("button", { name: "Confirm" });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirm.click();
    }

    await expect(page).toHaveURL(SUCCESS_PAGE_URL, { timeout: 30_000 });
    await expect(page.getByText("Passed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("submit button is disabled until a question is answered", async ({
    page,
    seedAssignment,
  }) => {
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      name: `Loop submit-guard ${Date.now()}`,
    });

    await beginAssignment(page, assignment, prompt);

    // No answer selected yet → header submit is disabled
    // (getSubmitButtonStatus: "No questions have been answered").
    const submitButton = page.getByRole("button", {
      name: "Submit assignment",
    });
    await expect(submitButton).toBeDisabled();

    // After selecting a choice it becomes enabled.
    await selectChoice(page, prompt, "4");
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  });
});

test.describe("Learner - attempts history", () => {
  test("attempts history table lists a completed attempt with its score", async ({
    page,
    apiContext,
    seedAssignment,
  }) => {
    // Seed an assignment, then drive+grade one attempt at the API level so the
    // attempts table has a settled, known row to assert against.
    const prompt = "What is 2 + 2?";
    const assignment = await seedAssignment({
      questions: [
        singleCorrect({
          prompt,
          choices: ["3", "4", "5"],
          correctIndex: 1,
        }),
      ],
      name: `Loop attempts-history ${Date.now()}`,
    });

    // Use the seeding helpers against the shared apiContext (same learner
    // identity as the browser storageState) so the attempt belongs to the
    // learner viewing the page.
    const { attemptId, gradingJobId } = await driveAttempt(apiContext, {
      assignmentId: assignment.id,
      answers: [{ kind: "choices", choices: ["4"] }],
    });
    const grading = await waitForGradingComplete(apiContext, {
      assignmentId: assignment.id,
      attemptId,
      gradingJobId,
    });
    expect(grading.status).toBe("Completed");

    // The attempts table is reached from the assignment landing page.
    await page.goto(`/learner/${assignment.id}/attempts`);

    await expect(
      page.getByRole("columnheader", { name: "Attempt #" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("columnheader", { name: "Score" }),
    ).toBeVisible();

    // A perfect objective answer → 100% score cell in the row.
    await expect(page.getByText("100%").first()).toBeVisible({
      timeout: 15_000,
    });
    // The View action links to the attempt's successPage.
    await expect(page.getByText("View").first()).toBeVisible();
  });
});

test.describe("Learner - upload-question submit guard", () => {
  // The in-progress-upload guard (getSubmitButtonStatus: isUploadingFiles →
  // disabled "File upload in progress...") requires an UPLOAD question AND a
  // real file-upload interaction that holds `isUploadingFiles` true mid-flight.
  // Wiring a deterministic mid-upload pause needs control over the upload
  // request (route interception/stub) that the current foundation does not
  // expose, and UPLOAD questions are LLM-graded so the rest of the loop can't
  // be asserted deterministically here. Left as a documented gap.
  test.fixme(
    "submit button is disabled mid-upload for an upload question",
    async () => {
      // TODO: seed an UPLOAD question (uploadQuestion factory), begin the
      // attempt, intercept the upload request to hold it pending, attach a
      // file, and assert the header "Submit assignment" button is disabled with
      // reason "File upload in progress..." while the request is in flight.
    },
  );
});
