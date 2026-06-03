/**
 * Issue-report modal (ReportModal) — author role.
 *
 * apps/web/components/ReportModal.tsx is the "Report an issue" dialog. On the
 * author questions page (apps/web/app/author/(components)/AuthorQuestionsPage/
 * index.tsx) a "Report Issue" button (rendered only when the assignment has at
 * least one question — the shared author assignment has the seeded MCQ) opens it.
 *
 * Client behavior under test:
 *   - Empty/whitespace description -> handleSubmitReport short-circuits with
 *     toast.error("Please provide a description for the report.") and the modal
 *     stays open. NO network call is made — purely client-side validation.
 *   - Non-empty description -> POST {origin}/api/v2/assignments/:id/report; on a
 *     truthy response toast.success("Report submitted successfully!") and the
 *     modal closes.
 *
 * The success path's POST is fulfilled with page.route so the test does not
 * depend on the report-persistence backend being wired in e2e (the component
 * only requires a truthy { success: true } body to show the success toast and
 * close). Toasts render via sonner's <Toaster/> mounted in LayoutContent.
 *
 * Role: author (this dir runs under the author-* projects; storageState is
 * author@example.com / pw-group) so the author assignment is editable.
 */
import { test, expect } from "../helpers/e2e-test";

const REPORT_ENDPOINT = "**/api/v2/assignments/*/report";

const EMPTY_DESCRIPTION_TOAST = "Please provide a description for the report.";
const SUCCESS_TOAST = "Report submitted successfully!";

test.describe("Author - issue report modal", () => {
  test.beforeEach(async ({ page, assignmentIds }) => {
    await page.goto(`/author/${assignmentIds.author.id}`);
    // The Report Issue button only renders once questions have loaded.
    await expect(
      page.getByRole("button", { name: "Report Issue" }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("opening the modal shows the report form", async ({ page }) => {
    await page.getByRole("button", { name: "Report Issue" }).click();

    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit Report" }),
    ).toBeVisible();
  });

  test("submitting with an empty description shows a validation toast and keeps the modal open", async ({
    page,
  }) => {
    // Guard: any report POST in this test would be a bug — validation must
    // short-circuit before the network call. Fail loudly if one is attempted.
    let reportRequestMade = false;
    await page.route(REPORT_ENDPOINT, async (route) => {
      reportRequestMade = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByRole("button", { name: "Report Issue" }).click();
    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toBeVisible();

    // Description left empty -> client-side validation toast.
    await page.getByRole("button", { name: "Submit Report" }).click();

    await expect(page.getByText(EMPTY_DESCRIPTION_TOAST)).toBeVisible({
      timeout: 10_000,
    });
    // Modal must remain open (submission was blocked).
    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toBeVisible();
    expect(reportRequestMade).toBe(false);
  });

  test("submitting a filled description shows a success toast and closes the modal", async ({
    page,
  }) => {
    // Stub the report POST so the success path is deterministic regardless of
    // whether report persistence is provisioned in the e2e stack.
    await page.route(REPORT_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByRole("button", { name: "Report Issue" }).click();
    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toBeVisible();

    await page
      .getByPlaceholder("Provide details about the issue...")
      .fill("Playwright E2E: the third choice renders with a stray comma.");

    await page.getByRole("button", { name: "Submit Report" }).click();

    await expect(page.getByText(SUCCESS_TOAST)).toBeVisible({
      timeout: 10_000,
    });
    // On success the modal closes.
    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toHaveCount(0, { timeout: 10_000 });
  });
});
