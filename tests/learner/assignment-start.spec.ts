import { test, expect } from "@playwright/test";
import { getLearnerAssignmentId } from "../helpers/assignment-helpers";
import { skipIfNotRole, setAuthCookie } from "../helpers/role-helpers";

test.describe("Learner - Assignment Start", () => {
  test.beforeEach(async ({ page }) => {
    skipIfNotRole("learner");
    await setAuthCookie(page, "learner");
  });

  test("should navigate to assignment and see start page", async ({ page }) => {
    const assignmentId = getLearnerAssignmentId();
    await page.goto(`/learner/${assignmentId}`);

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Verify the assignment page loads
    await expect(page).toHaveURL(new RegExp(`/learner/${assignmentId}`));

    // Add your specific assertions here based on your assignment structure
    // For example:
    // await expect(page.getByRole("heading", { name: "Assignment" })).toBeVisible();
    // await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("should display assignment information", async ({ page }) => {
    const assignmentId = getLearnerAssignmentId();
    await page.goto(`/learner/${assignmentId}`);

    // Add assertions for assignment details
    // For example:
    // await expect(page.getByText("Assignment type")).toBeVisible();
    // await expect(page.getByText("Time Limit")).toBeVisible();
    // await expect(page.getByText("Passing Grade")).toBeVisible();
  });
});
