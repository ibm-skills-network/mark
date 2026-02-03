import { test, expect } from "@playwright/test";
import { getAssignmentId } from "../helpers/assignment-helpers";

test.describe("Learner - Assignment Homepage", () => {
  test.beforeEach(async ({ page }) => {
    const assignmentId = getAssignmentId();
    await page.goto(`/learner/${assignmentId}?lang=en`);

    // Handle the initial confirmation dialog if present
    const confirmButton = page.getByRole("button", { name: "Confirm" });
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }
  });

  test("should display assignment title and header", async ({ page }) => {
    // Verify assignment title appears in both banner and main content
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

  test("should have a start/begin button", async ({ page }) => {
    // Look for a button to start the assignment
    const startButton = page.getByRole("button", { name: /begin|start/i });
    await expect(startButton).toBeVisible();
  });
});
