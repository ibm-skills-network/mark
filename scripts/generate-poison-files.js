#!/usr/bin/env node
/**
 * Generate test poison files for validating mark-jobs OOM protections.
 *
 * Run from the repo root so node_modules resolves:
 *   node scripts/generate-poison-files.js
 *
 * Outputs into ./poison-files/ :
 *   poison-clamp-defeat.xlsx  — exercises the OversizedSubmissionError path
 *   poison-many-pages.pdf     — stresses pdfjs canvas allocation
 *
 * Both files are designed to be safe to submit through staging's normal
 * upload-and-grade flow. They are NOT designed to defeat any security
 * control — they exercise the grading worker's resource-protection paths,
 * which is the failure mode the `large-file-protections` branch addresses.
 *
 * Submit each file to a graded assignment on staging and watch:
 *
 *   - Pod restart count       : kubectl get pods -l ... | awk '{print $4}'
 *   - GradingProgress row     : SELECT * FROM "GradingProgress" WHERE ...
 *   - Job status in BullMQ    : redis-cli LRANGE bull:mark.attempt:failed 0 5
 *   - LTI sync queue health   : ./scripts/lti-sync-check.sh
 *
 * Expected outcomes on the `large-file-protections` branch:
 *
 *   poison-block-cap.xlsx:
 *     60_000 populated rows in a tight A:D range. The used-range clamp
 *     from commit bba0b177 correctly keeps the range tight, so this does
 *     NOT exercise the clamp itself — it exercises what comes after:
 *     sheet_to_csv emits 60_000 lines, splitTextIntoEvidenceBlocks splits
 *     at line boundaries, the 50_000-block cap in that splitter fires,
 *     and OversizedSubmissionError surfaces. job-worker classifies that
 *     as branch A, wraps in UnrecoverableError, and the job moves
 *     straight to the BullMQ failed set with no pod crash. Validates the
 *     block-cap + permanent-fail end of the defense-in-depth chain.
 *
 *   poison-many-pages.pdf:
 *     A PDF with N minimal pages. pdfjs allocates per-page resources
 *     during structured extraction; with enough pages the worker memory
 *     trends toward the 2 GiB cgroup limit. Set N high enough that you
 *     reliably trip OOMKilled (exit 137) — start at 2000 and tune. This
 *     is the case the maxStalledCount=0 change protects against: previous
 *     default (maxStalledCount=1) re-delivered a SIGKILL'd job up to 2
 *     more times before BullMQ gave up, so one bad submission could
 *     OOMKill 3 separate pods. With the new config, the first stall
 *     recovery moves the job to failed and the cascade stops at 1 pod.
 */
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const OUT_DIR = path.resolve(process.cwd(), "poison-files");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function buildPoisonXlsx() {
  // 51_000 data rows + header = 51_001 CSV lines, which exceeds the
  // 50_000-block cap in splitTextIntoEvidenceBlocks by a small margin.
  // Tight numeric cells keep the file under 10 MB (staging upload limit)
  // while still reliably tripping the cap.
  const wb = XLSX.utils.book_new();
  const data = [["row_id", "a", "b", "c"]];
  for (let index = 0; index < 51_000; index++) {
    data.push([index, index, index, index]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = path.join(OUT_DIR, "poison-block-cap.xlsx");
  XLSX.writeFile(wb, out);
  const stat = fs.statSync(out);
  console.log(`Wrote ${out} (${(stat.size / 1024 / 1024).toFixed(2)} MiB)`);
}

async function buildPoisonPdf({ pageCount = 2000 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`page ${index + 1} of ${pageCount}`, {
      x: 20,
      y: 100,
      size: 10,
      font,
    });
  }
  const bytes = await doc.save();
  const out = path.join(OUT_DIR, "poison-many-pages.pdf");
  fs.writeFileSync(out, bytes);
  console.log(
    `Wrote ${out} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB, ${pageCount} pages)`,
  );
}

(async () => {
  await buildPoisonXlsx();
  await buildPoisonPdf({
    pageCount: Number.parseInt(process.env.PDF_PAGES ?? "2000", 10),
  });
  console.log("\nDone. Submit each file to a graded assignment on staging.");
  console.log(
    "Watch pod restarts, GradingProgress.status, and ./scripts/lti-sync-check.sh.",
  );
})().catch((error) => {
  console.error("Generation failed:", error);
  process.exit(1);
});
