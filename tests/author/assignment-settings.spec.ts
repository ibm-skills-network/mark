import { test, expect } from "../helpers/e2e-test";

test("author settings persist and reflect in preview", async ({
  page,
  assignmentIds,
}) => {
  // Navigate to author assignment page
  await page.goto(`/author/${assignmentIds.author.id}`);

  // Open Settings tab
  await page.getByRole("button", { name: "Settings" }).click();

  // Set assignment type to Graded
  await page.getByRole("button", { name: "Graded This assignment's" }).click();

  // Enable strict time limit
  const strictTimeLimitSwitch = page.getByRole("switch", {
    name: "Enforce a strict time limit",
  });
  if ((await strictTimeLimitSwitch.getAttribute("aria-checked")) !== "true") {
    await strictTimeLimitSwitch.click();
  }

  // Set allotted time to 25 minutes
  const timeLimitInput = page.getByPlaceholder("Enter time limit in minutes");
  await expect(timeLimitInput).toBeVisible();
  await timeLimitInput.fill("25");

  // Set number of attempts (dropdown)
  await page
    .locator("section", {
      hasText: "How will learners complete the assignment",
    })
    .locator("button")
    .click();
  const attemptsOption = page.locator("#dropdown-portal li", {
    hasText: /^3$/,
  });
  await expect(attemptsOption).toBeVisible();
  await attemptsOption.click();

  // Set passing grade to 45%
  await page.getByPlaceholder("Ex.").fill("45");

  // Set retry behavior
  await page.locator("#attempts-before-cooldown-period").click();
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
  await expect(page1.getByText("Graded", { exact: true })).toBeVisible();

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
