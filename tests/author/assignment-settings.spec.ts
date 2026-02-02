import { test, expect } from "@playwright/test";
import { getAssignmentId } from "../helpers/assignment-helpers";

test("author settings persist and reflect in preview", async ({ page }) => {
  // Navigate to author assignment page
  const assignmentId = getAssignmentId();
  await page.goto(`/author/${assignmentId}`);

  // Open Settings tab
  await page.getByRole("button", { name: "Settings" }).click();

  // Set assignment type to Graded
  await page.getByRole("button", { name: "Graded This assignment's" }).click();

  // Enable strict time limit
  await page
    .getByRole("switch", { name: "Enforce a strict time limit" })
    .click();

  // Set allotted time to 25 minutes
  await page.getByPlaceholder("Enter time limit in minutes").fill("25");

  // Set number of attempts (dropdown)
  await page.getByRole("button", { name: "Dropdown Arrow" }).click();
  await page.getByText("3", { exact: true }).click();

  // Set passing grade to 45%
  await page.getByPlaceholder("Ex.").fill("45");

  // Set retry behavior
  await page
    .getByRole("button", { name: "How many attempts do learners" })
    .click();
  await page.getByText("Never wait to retry").click();

  // Set question display options
  await page
    .getByRole("button", { name: "All questions in one page All" })
    .click();
  await page
    .getByRole("button", { name: "Strict Order Questions always" })
    .click();

  // Open preview
  const page1Promise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview" }).click();
  const page1 = await page1Promise;

  // Verify assignment type is reflected
  await expect(page1.getByText("Assignment type")).toBeVisible();
  await expect(page1.getByText("Graded")).toBeVisible();

  // Verify time limit and estimated time are shown
  await expect(page1.getByText("Time Limit")).toBeVisible();
  await expect(page1.getByText("minutes").first()).toBeVisible();

  await expect(page1.getByText("Estimated Time")).toBeVisible();
  await expect(page1.getByText("minutes").nth(1)).toBeVisible();

  // Verify attempts and passing grade
  await expect(page1.getByText("Assignment attempts")).toBeVisible();
  await expect(page1.getByText("attempts left")).toBeVisible();

  await expect(page1.getByText("Passing Grade")).toBeVisible();
  await expect(page1.getByText("45%")).toBeVisible();
});
