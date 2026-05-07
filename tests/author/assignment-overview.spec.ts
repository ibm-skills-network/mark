import { test, expect } from "../helpers/e2e-test";

test.describe("Author - Assignment Overview", () => {
  test("should edit assignment overview content and verify in preview", async ({
    page,
    assignmentIds,
  }) => {
    await page.goto(`/author/${assignmentIds.author.id}`);

    // Edit introduction section
    const introSection = page.locator("section", {
      has: page.getByRole("heading", {
        name: /what is this assignment about/i,
      }),
    });
    await introSection.locator(".ql-editor").click();
    await introSection
      .locator(".ql-editor")
      .fill(
        "This assignment is about testing with playwright, and ensuring assignment overview saves.",
      );

    // Edit instructions section
    const instructionsSection = page.locator("section", {
      has: page.getByRole("heading", {
        name: /what are the instructions to successfully completing this assignment/i,
      }),
    });
    await instructionsSection.locator(".ql-editor").click();
    await instructionsSection
      .locator(".ql-editor")
      .fill(
        "The instructions to complete this assignment include answering all questions correctly, and to not cheat.",
      );

    // Edit grading criteria section
    const gradingSection = page.locator("section", {
      has: page.getByRole("heading", {
        name: /how will learners be graded on this assignment/i,
      }),
    });
    await gradingSection.locator(".ql-editor").click();
    await gradingSection
      .locator(".ql-editor")
      .fill(
        "Learners will be graded on this assignment using accurate rubrics to answer questions.",
      );

    // Open preview and verify content changes
    const previewPagePromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Preview" }).click();
    const previewPage = await previewPagePromise;

    // Verify updated content appears in preview
    await expect(
      previewPage.getByText("This assignment is about"),
    ).toBeVisible();
    await expect(
      previewPage.getByText("The instructions to complete"),
    ).toBeVisible();
    await expect(
      previewPage.getByText("Learners will be graded on"),
    ).toBeVisible();
  });
});
