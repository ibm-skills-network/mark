# TipTap migration plan and focused review

Replace the Quill runtime with TipTap 3 while preserving existing HTML content, author formatting, and learner submissions. Keep a temporary HTML compatibility layer so legacy records remain usable without retaining the vulnerable Quill packages. This phase changes application code only: no database operations, schema migrations, background migration job, or deployment.

## Decision

Fix the current branch. Its separation between a TipTap editor, a static sanitized viewer, and shared legacy HTML rules is useful. Rebuilding would still require the same compatibility work. The existing tests provide a starting point, but toolbar button counts and text-only comparisons do not establish formatting parity.

## Findings in the original branch

- Paragraph indentation is deliberately discarded by `block-indent.ts`, and indent controls only operate on lists. This violates the existing-format and unchanged-content requirements.
- Legacy alignment and direction classes are not converted into attributes the new editor understands; removing Quill CSS removes their presentation too.
- Images use TipTap's default block representation although Quill images were inline. The image control accepts URLs but has lost Quill's local-file insertion behavior.
- Code highlighting is configured, but the language list is never rendered as a picker. Authors cannot reproduce a stored language choice.
- Word and character limits are captured when the editor is created, so changed props do not update enforcement. The same transaction filter can reject externally loaded content.
- The old `disableListAutofill`, `blockImages`, and `onImageBlocked` props were removed. Retain their contracts instead of relying on current call sites not needing them.
- The source asserts that content-error reporting preserves unsupported HTML. TipTap's schema still discards unsupported elements and attributes; error reporting is not a preservation mechanism.
- Mixed numbered and bulleted lists restart numbering, leading indentation and level jumps are flattened, and checklist states are discarded.
- Hard breaks are omitted from counts and list wrappers add extra characters. Significant whitespace in prose is not preserved consistently between the editor and viewer.

## Implementation

1. Keep TipTap 3 as the sole editable runtime and static HTML as the viewer. Continue storing HTML; do not introduce editor-specific storage or infer an editor from record age.
2. Repair the legacy HTML rules and TipTap schema together. Preserve paragraph indentation, alignment, right-to-left direction, inline images, list nesting, code text and language, links, and supported embeds. Run normalization before final sanitization, and leave unchanged HTML byte-identical when no rule applies.
3. Restore missing author controls and existing component props. Verify what commands do, not just that buttons exist. Preserve learner input restrictions and update limits without recreating the editor or losing its selection.
4. Keep loading separate from editing. Viewing, mounting, external resets, and loading an answer must not emit a save. Explicit edits may produce canonical HTML, but must retain the original document's supported content and formatting.
5. Add regression checks using old HTML and newly authored HTML through real TipTap parsing, editing, serialization, and the static viewer. Check counters, limit changes, external loads, syntax highlighting, sanitization, and image restrictions. Verify Quill runtime dependencies remain absent.

## Staging validation

Compare existing submissions and new content side by side in staging before release. Cover author screens, learner answers, submission results, version previews, translated content, both toolbar modes, and light and dark themes. Include nested mixed lists, numbering continuity, skipped indentation levels, stored checklist states, significant spaces, all alignments, right-to-left text, inline and local-file images, code language selection, blank paragraphs, links, and permitted video embeds.

Opening or viewing an existing record must leave stored values unchanged. Editing a copy of old content must preserve formatting outside the selection. Test responses at and over both limits, paste, undo and redo, changed question limits, and loading another answer. Mend must report no Quill finding before the security ticket is closed.

The existing offline row validator checks text retention, remaining legacy markers, and idempotency. It does not establish formatting parity or prove that content survives the editor schema, so it cannot replace these staging comparisons.

## Code changes completed

The compatibility rules now retain block indentation, alignment, direction, numbering continuity, numbering styles, indentation gaps, and stored checklist state. The TipTap schema round-trips those attributes and keeps images inline. The viewer uses matching CSS and preserves significant spaces.

The full toolbar now supports code language selection, local image uploads, and ordinary YouTube and Vimeo URLs. Image files can also be pasted and dropped. Existing import paths and the list-autofill and image-blocking props remain supported. Asynchronous image insertion follows intervening edits and is cancelled if another answer loads.

Limits read current props without recreating the editor. Counts include hard breaks and omit list wrappers. Loading or resetting an existing answer bypasses limits, emits no save, and clears prior undo history; explicit edits still enforce limits. Stored and pasted HTML are normalized before sanitization, and emitted HTML is sanitized too.

Regression tests cover these behaviors using synthetic legacy and new content. Real staging records and the Mend job remain release checks.

## Local validation

- 83 shared HTML normalization and empty-content tests passed.
- 120 focused web tests passed across the editor, viewer, schema, limits, image insertion, sanitizer, learner components, and persisted learner state.
- 9 API blank-submission helper tests passed.
- TypeScript checks passed for the web app and shared package. Web lint passed with four existing warnings and no errors.
- A standalone Chromium smoke test passed for legacy formatting, numbering, checklist markers, syntax highlighting, toolbar commands, image upload, video URL conversion, changed limits, and external answer loading. It used synthetic content and no backend connection.

No database operations, staging deployment, or background migration job were performed. Staging comparisons and Mend verification remain outstanding.

## Review cleanup

Removed 725 net lines from the reviewed editor code and tests, mostly comments and duplication. Four formatting extensions now share one implementation, the client wrapper reuses the editor props, and counter rendering is shared. Regression coverage remains intact.

## Later retirement of legacy support

After staging confirms compatibility, separately plan a resumable background normalization job with original-value backups, conflict protection, and coverage of drafts, versions, translations, submissions, imports, and restored backups. Do not implement or run that job in this phase. Remove legacy conversion only after migration and remaining input paths have been verified.
