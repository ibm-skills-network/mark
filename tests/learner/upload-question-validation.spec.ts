/**
 * Upload-question client-side file validation (learner role).
 *
 * An UPLOAD question renders FileUploadSection -> FileUploader
 * (apps/web/components/FileUploader.tsx), a react-dropzone with a hidden
 * <input type="file">. For the learner UPLOAD path FileUploadSection passes a
 * non-empty `acceptedFileTypes` map (UPLOAD allows .txt/.pdf/.docx/.xls/.xlsx/
 * .csv/.md/.pptx/.ipynb) and the default `restrictFileTypes=true`, so
 * react-dropzone enforces the `accept` set in-browser:
 *   - a file whose extension is NOT in the accept set is rejected client-side
 *     (onDropRejected is a no-op here) -> the file is never added, so no upload
 *     row appears and no network call is made;
 *   - a file whose extension IS allowed is accepted and an upload is started.
 *
 * To keep BOTH assertions deterministic without provisioning S3, we stub the
 * presigned-URL endpoint (POST /api/v1/files/upload) to fail. A VALID file then
 * produces a visible upload row that settles to an error message (proving the
 * file was ACCEPTED client-side and an upload was attempted); a WRONG-TYPE file
 * produces NO row at all (proving it was REJECTED before any upload).
 *
 * The full happy-path (presigned PUT to object storage + LLM grading of the
 * uploaded file) is left as a documented test.fixme — it needs a stubbed
 * presign+PUT pair and UPLOAD answers are LLM-graded (non-deterministic value).
 *
 * Role: learner. Each test owns a freshly-seeded UPLOAD assignment via the
 * `seedAssignment` fixture (auto-deleted in teardown).
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { uploadQuestion } from "../helpers/factories/question-factories";
import type { SeededAssignment } from "../helpers/seed";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const VALID_FILE = path.join(FIXTURES_DIR, "sample-upload.txt"); // .txt is allowed
const WRONG_TYPE_FILE = path.join(FIXTURES_DIR, "not-an-allowed-type.png"); // .png is not

const UPLOAD_PROMPT = "Upload your solution as a text file.";

const PRESIGN_ENDPOINT = "**/api/v1/files/upload";

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

async function beginUploadAttempt(page: Page, assignment: SeededAssignment) {
  await page.goto(`/learner/${assignment.id}?lang=en`);
  await dismissLanguageModalIfPresent(page);
  await page
    .getByRole("button", { name: "Begin", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/questions/, { timeout: 15_000 });
  await expect(page.getByText(UPLOAD_PROMPT)).toBeVisible({ timeout: 15_000 });
}

test.describe("Learner - upload question client validation", () => {
  test("the dropzone advertises the allowed file types and max size", async ({
    page,
    seedAssignment,
  }) => {
    const assignment = await seedAssignment({
      questions: [
        uploadQuestion({ prompt: UPLOAD_PROMPT, responseType: "REPORT" }),
      ],
      name: `Upload validation hints ${Date.now()}`,
    });
    await beginUploadAttempt(page, assignment);

    // The FileUploader renders its constraints up front.
    await expect(page.getByText(/Allowed file types:/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Maximum file size:/i)).toBeVisible();
  });

  test("a valid-type file is accepted and an upload is attempted", async ({
    page,
    seedAssignment,
  }) => {
    // Fail the presign call so the (accepted) upload settles deterministically
    // to an error row without needing real object storage.
    await page.route(PRESIGN_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stubbed presign failure" }),
      });
    });

    const assignment = await seedAssignment({
      questions: [
        uploadQuestion({ prompt: UPLOAD_PROMPT, responseType: "REPORT" }),
      ],
      name: `Upload validation accept ${Date.now()}`,
    });
    await beginUploadAttempt(page, assignment);

    // The hidden file input is the upload target.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(VALID_FILE);

    // The file was accepted client-side -> an upload row for it appears
    // (filename shown). Since presign was stubbed to fail, it settles to error
    // — either is proof the file passed client validation and an upload began.
    await expect(page.getByText("sample-upload.txt").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a wrong-type file is rejected client-side and never starts an upload", async ({
    page,
    seedAssignment,
  }) => {
    // If a presign request is made, the wrong-type file was wrongly accepted.
    let presignRequested = false;
    await page.route(PRESIGN_ENDPOINT, async (route) => {
      presignRequested = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "should not be called" }),
      });
    });

    const assignment = await seedAssignment({
      questions: [
        uploadQuestion({ prompt: UPLOAD_PROMPT, responseType: "REPORT" }),
      ],
      name: `Upload validation reject ${Date.now()}`,
    });
    await beginUploadAttempt(page, assignment);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(WRONG_TYPE_FILE);

    // The dropzone stays in its idle state — a rejected file never flips the
    // uploader into the "Upload in progress..." state (real-condition wait, no
    // sleep), so we can safely assert the rejection afterwards.
    await expect(
      page.getByText("Drag & drop files here, or click to select files."),
    ).toBeVisible();
    await expect(page.getByText("Upload in progress...")).toHaveCount(0);

    // The .png is not in the UPLOAD accept set -> react-dropzone rejects it, so
    // no upload row (and no "Uploaded Files" list) ever appears for it, and no
    // presigned-URL request is made.
    await expect(page.getByText("not-an-allowed-type.png")).toHaveCount(0);
    await expect(page.getByText("Uploaded Files")).toHaveCount(0);
    expect(presignRequested).toBe(false);
  });

  // Full happy-path: a valid file uploads to object storage and the UPLOAD
  // answer is graded. Left as a gap because it requires (a) stubbing the
  // presigned-URL POST AND the subsequent S3 PUT as a coherent pair, and (b)
  // UPLOAD questions are LLM-graded so the grade value is non-deterministic —
  // there is no E2E_FAKE_LLM stub in the current foundation.
  test.fixme(
    "a valid file uploads successfully and the upload-question attempt grades",
    async () => {
      // TODO: page.route the presign POST (/api/v1/files/upload) to return a
      // fake { presignedUrl } pointing at an intercepted route, fulfil that PUT
      // with 200, assert the file appears under "Uploaded Files", submit, and
      // (only once an LLM stub exists) assert the SSE loop reaches /successPage.
    },
  );
});
