import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/e2e-test";

async function dismissLanguageModalIfPresent(page: Page) {
  const modalTitle = page.getByText(
    "Please pick one of the available languages",
  );
  await modalTitle.waitFor({ state: "visible", timeout: 1_000 }).catch(() => {
    return null;
  });

  if (!(await modalTitle.isVisible())) {
    return;
  }

  const modal = page.locator("div.fixed.inset-0.z-50").filter({
    has: modalTitle,
  });
  const confirmButton = modal.getByRole("button", { name: "Confirm" });
  if (await confirmButton.isDisabled()) {
    await modal
      .getByRole("button", { name: /Select language|English/i })
      .click();
    await page
      .locator("#dropdown-portal")
      .getByText("English", { exact: true })
      .click();
  }

  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
}

test.describe("Learner - Assignment Homepage", () => {
  test.beforeEach(async ({ page, assignmentIds }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en`);
    await dismissLanguageModalIfPresent(page);
  });

  // Verify assignment title appears in both banner and main content
  test("should display assignment title and header", async ({ page }) => {
    await expect(
      page
        .getByRole("banner")
        .getByRole("heading", { name: "Playwright Assignment" }),
    ).toBeVisible();

    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Playwright Assignment" }),
    ).toBeVisible();
  });

  test("should display assignment metadata correctly", async ({ page }) => {
    // Verify assignment type
    await expect(page.getByText("Assignment type")).toBeVisible();
    await expect(page.getByText("Graded", { exact: true })).toBeVisible();

    // Verify time limits
    await expect(page.getByText("Time Limit")).toBeVisible();
    await expect(page.getByText("30 minutes")).toBeVisible();

    await expect(page.getByText("Estimated Time")).toBeVisible();
    await expect(page.getByText("15 minutes")).toBeVisible();

    // Verify attempts information
    await expect(page.getByText("Assignment attempts")).toBeVisible();
    await expect(page.getByText("attempts left")).toBeVisible();

    // Verify passing grade
    await expect(page.getByText("Passing Grade")).toBeVisible();
    await expect(page.getByText("%")).toBeVisible();
  });

  test("should display assignment content sections", async ({ page }) => {
    // Verify introduction/about section
    await expect(
      page.getByText("This is a test assignment created by Playwright."),
    ).toBeVisible();

    // Verify instructions section
    await expect(
      page.getByRole("heading", { name: "Instructions" }),
    ).toBeVisible();
    await expect(
      page.getByText("Complete all questions to the best of your ability."),
    ).toBeVisible();

    // Verify grading criteria section
    await expect(
      page.getByRole("heading", { name: "Grading Criteria" }),
    ).toBeVisible();
    await expect(
      page.getByText("Answers will be graded on correctness."),
    ).toBeVisible();
  });

  test("should navigate to attempts history and back", async ({ page }) => {
    // Check if there's an attempt history (may not exist on first run)
    const seeAllAttemptsLink = page.getByRole("link", {
      name: "See all attempts",
    });

    if (await seeAllAttemptsLink.isVisible()) {
      // Navigate to attempts history
      await seeAllAttemptsLink.click();

      // Verify we can return to assignment details
      const returnButton = page.getByRole("button", {
        name: "Return to Assignment Details",
      });
      await expect(returnButton).toBeVisible();
      await returnButton.click();

      // Verify we're back on the assignment page
      await expect(
        page.getByRole("heading", { name: "Playwright Assignment" }),
      ).toBeVisible();
    }
  });
});
