import { test, expect } from "../helpers/e2e-test";

test.describe("Learner - Assignment Start", () => {
  test("should navigate to assignment and see start page", async ({
    page,
    assignmentIds,
  }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}`);

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Verify the assignment page loads
    await expect(page).toHaveURL(
      new RegExp(`/learner/${assignmentIds.learner.id}`),
    );

    // Add your specific assertions here based on your assignment structure
    // For example:
    // await expect(page.getByRole("heading", { name: "Assignment" })).toBeVisible();
    // await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("should display assignment information", async ({
    page,
    assignmentIds,
  }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}`);

    // Add assertions for assignment details
    // For example:
    // await expect(page.getByText("Assignment type")).toBeVisible();
    // await expect(page.getByText("Time Limit")).toBeVisible();
    // await expect(page.getByText("Passing Grade")).toBeVisible();
  });
});
