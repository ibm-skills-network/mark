/**
 * Question-type coverage: UPLOAD (OPEN, LLM-graded; real file upload).
 *
 * This path has TWO infra dependencies that a key-less / storage-less CI run
 * does not satisfy, so the test is marked test.fixme:
 *   1. File upload: the learner FileUploader requests a presigned URL from
 *      `/v1/files/upload` and PUTs the file to object storage
 *      (uploadFileToStorage). That requires object storage to be configured for
 *      the e2e api.
 *   2. Grading: UPLOAD answers are graded by a real LLM (no e2e fake-LLM stub),
 *      so without a grading key the loop never reaches /successPage.
 *
 * The flow below is real and runnable; it (a) uploads via setInputFiles on the
 * react-dropzone hidden <input>, (b) WAITS for the upload to finish (the
 * "Uploaded Files" list appears and the submit button is enabled — isUploading
 * gates the submit button via getSubmitButtonStatus), then (c) submits and
 * waits on the SSE-driven success transition. We assert STRUCTURE ONLY.
 *
 * TODO(upload-e2e): enable once (a) object storage is wired into the e2e api
 * AND (b) a grading key or E2E_FAKE_LLM stub is available. Until then this is a
 * documented gap, not a broken test.
 */
import path from "node:path";
import { test, expect } from "../../helpers/fixtures";
import { uploadQuestion } from "../../helpers/factories/question-factories";
import { beginAssignment, submitAndAwaitSuccess } from "./_flow";

const FIXTURE_FILE = path.resolve(
  __dirname,
  "../../fixtures/sample-upload.txt",
);

test.use({
  freshAssignmentQuestions: [
    uploadQuestion({
      // responseType OTHER accepts generic files (.txt/.pdf/.docx) via
      // FileUploadSection's getAcceptedFileTypes; the default CODE would reject .txt.
      prompt: "Upload your written report as a text file.",
      responseType: "OTHER",
      points: 8,
    }),
  ],
});

test.describe("Question types - UPLOAD", () => {
  test.fixme(
    "uploading a file and waiting for upload completion runs the grading loop",
    async ({ page, freshAssignment }) => {
      await beginAssignment(page, freshAssignment.id);

      await expect(
        page.getByText("Upload your written report as a text file."),
      ).toBeVisible();

      // react-dropzone renders a hidden file <input>; set the fixture file on
      // it directly (setInputFiles works on hidden inputs).
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(FIXTURE_FILE);

      // WAIT for the upload to actually complete before submitting: the
      // "Uploaded Files" section only appears once the presigned PUT resolves,
      // and the submit button is disabled while isUploadingFiles is true.
      await expect(page.getByText("Uploaded Files")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("sample-upload.txt")).toBeVisible();

      await submitAndAwaitSuccess(page, freshAssignment.id);

      // Structure only — no numeric score assertion for an LLM-graded type.
      await expect(page.getByText(/Final Score:/)).toBeVisible();
    },
  );
});
