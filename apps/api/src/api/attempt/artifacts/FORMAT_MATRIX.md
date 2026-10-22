# Artifact format migration inventory

This inventory records the legacy extraction surface inspected on 2026-10-22. It is not a declaration that every extension below is gradeable or migrated. The canonical parser's executable capability registry and tests are authoritative for the new path. An upload picker, MIME match, nonempty string, or parser return alone does not establish evidence completeness.

## Existing adapters and migration requirements

| Family | Existing variants and dependencies | Evidence and known limits | Required canonical fixtures |
| --- | --- | --- | --- |
| PDF | `pdf-parse`, `pdfjs-dist`, native `canvas` | Text/page blocks and embedded raster images. Legacy caps: 12 million pixels/image, 20 images/page, 60/document. Rendered/vector evidence, image masks and exhausted image budgets require explicit omissions. | Late-page decisive content; embedded raster and masks; scanned-only and mixed pages; corrupt/encrypted/truncated PDF; image/pixel caps; timeout, process crash and recovery. |
| Spreadsheets | XLSX/XLS via SheetJS; XLSX ZIP/XML charts/pivots/images; CSV/TSV via `csv-parser`; ODS ZIP/XML | Sparse used-range compaction avoids walking a full worksheet. XLSX chart/pivot descriptions are not rendered visual fidelity. Legacy limits include 50 chart parts, 50 pivot parts, 5 MB/part, 400 inflated parts, 200 worksheets/relationships and 8 series ranges. CSV rows cap at 1 MiB. | Sparse full-sheet dimensions; chart alternate namespace; chart relationships and values on other sheets; formulas, hidden cells, images; malformed relationships; dishonest compressed size; expansion caps; empty sheet. |
| Notebooks | IPYNB JSON; code/markdown, streams, execution results and rendered PNG/JPEG outputs | Legacy captures at most 12 distinct images of at most 1.5 MB each. Unsupported/vector outputs and clipped text must be omissions. Notebook parsing must never execute learner code or call a model. | Code/output after 200 characters; multiple cells; false/zero values; repeated images; rendered plot; oversized or unsupported image; invalid JSON; invalid cell/output shape; resource budget. |
| Source and plain text | Source extensions, TXT/MD/RST/TeX, HTML/CSS/components, JSON/XML/YAML/TOML/INI/SQL | Legacy generic sanitized text cap is 500,000 characters. Original file/line identity must remain stable; code must never execute. Binary bytes must not become apparent text evidence. | Late-file decisive content; UTF-8, empty, malformed encoding, binary disguised as text; exact line references; no prefix-only successful extraction. |
| Archives | ZIP/ZIPX/JAR via `unzipper`; TAR/GZ/TGZ/7Z/RAR currently return failed extraction metadata | Legacy ZIP inspects selected source/text files: entry declared size <100,000 bytes, text entry 1,000 characters, total content budget 2 million characters. Some skipped entries are represented only in listing/prose. | Multiple source files including second decisive file; path traversal/absolute paths/backslashes; nesting, duplicate paths, symlinks, entry count, honest/dishonest expansion sizes; unrelated binary entries recorded as omissions. |
| Images | PNG/JPEG/GIF/WEBP/BMP/TIFF/ICO/HEIC/HEIF metadata fallback | Generic extractor provides metadata, not OCR. Original image resource is evidence; metadata is not a substitute. Animated frames and unsupported encodings must be explicit. | Valid image resource integrity and dimensions; malformed headers/bytes; excessive decoded pixels; unsupported animation; original resource retained. |
| Presentations | PPTX ZIP/XML slides and notes, ODP ZIP/XML; PPT binary string heuristic | Extracted slide text does not capture visual layout, diagrams, transitions or charts. Historical PPT fallback is not full extraction. | Slide order and notes; image-only slide; chart/diagram omissions; corrupt package; late slide; bounded expansion. |
| Documents | DOCX via `mammoth`, ODT ZIP/XML, RTF; DOC tries `mammoth`/fallback | Raw text may omit figures, equations, layout and embedded objects. Existing fallback success is not complete document support. | Late paragraph; table; image-only document; unsupported embedded objects; corrupt ZIP; bounded expansion; unsupported old binary variant. |
| URLs and repositories | URL fetch helper and GitHub-specific content fetch outside generic file extraction | Original URL and resolved target/commit must be pinned. Redirect/network authorization is independent from parsing. HTML text alone is not screenshot, interactive page, or repository evidence. | Redirect revalidation, private/loopback/link-local denial, timeout/size limits, storage/fetch outage, changed remote content, pinned commit and multiple source files. |
| Other legacy extensions | SQLite/DB, media, EML/MSG, calendar/contact formats | Some paths merely find binary strings or metadata. These are inventory entries, not a promise of gradeability. | Explicit unsupported outcome unless a separately verified evidence capability is delivered. |

Legacy source: `../services/file-content-extraction.ts`, `../services/pdf-structure-extractor.service.ts`, and `../../llm/features/grading/services/spreadsheet-used-range.utils.ts`. Browser convenience maps remain in `apps/web/lib/upload-accept.ts`; their extension lists differ from the backend's broad fallback dispatcher.

## Fixture ownership and evidence

Backend artifact maintainers own canonical parser and source-lifecycle tests. Existing regression fixtures belong to the legacy extraction suite and remain useful controls; a passing legacy fixture does not prove the canonical boundary or production image works.

- `../services/__tests__/fixtures/pdf-embedded-raster-image.pdf` and `pdf-embedded-image-mask.pdf`: real embedded-image inputs.
- `../services/__tests__/fixtures/xlsx-charts-legends-pivot.xlsx` and `xlsx-charts-openpyxl-default-ns.xlsx`: real OOXML variants.
- `../services/__tests__/fixtures/fixture-xcode.zip`: archive/code input.
- `file-content-extraction.xlsx-hardening.spec.ts`: generated hostile OOXML relationships and dishonest inflation sizes.
- `file-content-extraction.spec.ts`: generated notebook cell/output/plot cases, source code and workbook controls.
- Canonical adapter tests live beside their parser implementation. CI fixtures must be deterministic and must not make LLM calls. Real-LLM assignment benchmarks remain explicitly on demand.

## Storage boundary and retained originals

Existing multipart `FileUpload` rows identify a user, upload ID, key and bucket with PENDING/COMPLETED/ABORTED status. They do not identify an attempt, question, immutable version, or content checksum. Existing single presigned PUT and direct upload flows do not create the same completion record. Legacy learner object paths encode assignment/user/question, not attempt.

The canonical adapter must therefore authorize the attempt and question, establish completed server-observed source bytes, and bind the source to that attempt. A matching checksum never grants access. Reuse requires source identity, digest, parser/configuration identity and independent ownership checks. Changing bytes under an existing key must fail integrity checks rather than replace historical evidence.

Existing generic delete/move/rename/folder operations predate immutable artifacts. Retained originals must be protected from these paths or placed in a namespace these operations cannot mutate. An artifact manifest pointing at a deleted mutable upload is insufficient retention. Cleanup must respect historical submissions and active processing; delayed retries must not use another attempt's source.

## Isolation and release evidence

The legacy file byte budget defaults to 1,000 MiB in flight and a 60-second admission wait, and uploads default to 100 MiB unless configured. These are admission settings, not parser memory, decompression, or execution isolation. Legacy PDF.js/canvas execute within the Node process. The existing production Dockerfiles originally included no Poppler tools; installing a parser dependency must include the actual API/worker image and a fixture executed in that image.

Canonical limits must include input bytes, expanded bytes, entry count/nesting, output bytes/blocks, process deadline and memory. A timeout must kill the process and remove its temporary resources. Cancellation and a failed parser must leave unrelated work usable. Capture explicit success, empty, partial, unsupported and failed states; partial cannot be upgraded merely because text exists.

Part 04 completion requires the supported format slices, source authorization, persisted/versioned manifests, early-processing status, submission-time revalidation and deployed-image parser checks. A completed PDF adapter alone closes a PDF slice. Production enablement, observed valid-work completion, grading sufficiency under Part 05 and eventual legacy retirement are separate gates and must not be inferred from unit tests.
