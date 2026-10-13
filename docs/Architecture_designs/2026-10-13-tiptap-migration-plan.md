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

At completion of local validation, no database operations, staging deployment, or background migration job had been performed.

## Review cleanup

Removed 725 net lines from the reviewed editor code and tests, mostly comments and duplication. Four formatting extensions now share one implementation, the client wrapper reuses the editor props, and counter rendering is shared. Regression coverage remains intact.

## Staging results, 2026-10-13

The user subsequently authorized staging database access and scoped test tokens. Testing used Chromium against the deployed application, existing records, and an isolated temporary assignment. No migration job or schema change was made.

On image `2.8.4-rc1`, 94 distinct HTML values from 225 sampled fields retained their non-whitespace text through the deployed editor. Samples covered assignments, questions, responses, versions, and translations. Synthetic legacy content also retained significant spaces, indentation, alignment, direction, inline images, mixed-list numbering, checklist states, and code highlighting. This sampling is not proof of visual parity for every stored record.

Both toolbars, heading levels, colours, links, code languages, author image upload/paste/drop, learner image blocking and notification, word and character limits, literal list markers, sanitized HTML paste, video embedding, preview rendering, and light/dark styling passed. New HTML and its code language persisted in a draft version without changing the published legacy version. Learner edits survived a same-browser reload.

Opening existing author records emitted no assignment-content writes. Existing submitted responses rendered correctly. Database comparisons confirmed that four original assignments, their questions and current versions, and the two responses in the inspected submitted attempt remained unchanged. The temporary assignment, group, attempt, response, versions, and associated test chats were removed afterward.

After redeployment, 27 core browser checks passed and two failed. Legacy version viewing, new draft version viewing, undo/redo, and switching the UI language were checked separately. Three issues remain:

- A fresh learner session opens a saved answer blank. The API supplies responses at the attempt level, while question hydration reads only each question's responses. The relevant hydration and mapping code is unchanged from `master`; same-browser local persistence masks the failure.
- Learner server rendering throws `DOMMatrix is not defined` (digest `2909363571`). React reports error 419 and falls back to client rendering. The browser eventually becomes usable, but the SSR failure remains. The browser PDF reader is imported at module scope in unchanged code. [React error 419](https://react.dev/errors/419) describes this fallback.

- Version history intermittently omits the new draft despite the versions API returning it. Assignment hydration overwrites the full version list with the embedded active-version subset. Delaying the versions response restores both rows; delaying assignment hydration hides the draft. These hydration and loading functions are unchanged from `master`. Both old and new version viewers retain formatting and code highlighting when their rows are available.

Quill packages were absent from the TipTap app container. Both Mend checks succeeded for PR head `43864f33`: [PR checks](https://github.com/ibm-skills-network/mark/pull/675/checks).

Staging briefly rolled back to Quill image `2.8.2`, then the user restored `2.8.4-rc1`. The final tests above ran against the restored TipTap `3.31.3` deployment. The temporary fixture was removed and the original-record comparisons passed again afterward. Firefox and Safari were not tested. Resolve the saved-answer hydration issue before release; the learner rendering error and version-list race also remain follow-up work.

## Follow-up fixes, 2026-10-13

Saved-answer hydration now joins attempt-level responses to questions and selects the newest response across both response locations. Draft answers from the same attempt take precedence, including empty text, cleared selections, and false boolean answers. Drafts from other attempts are discarded.

The PDF parser loads only when reading a PDF, so importing the learner page no longer evaluates its browser-only dependencies on the server. Assignment hydration no longer overwrites the version list; the dedicated versions endpoint owns it.

Regression tests reproduced all three failures before the fixes. Afterward, 101 tests passed across hydration, file reading, learner persistence, version loading, limits, schema round-tripping, and related learner components. TypeScript, targeted lint, and the production build passed. Six Chromium checks against the local production build with a synthetic API verified fresh-session legacy answer restoration above the limit, cleared answers and drafts surviving reload, error-free learner rendering, and both version rows remaining visible with either API response delayed.

These fixes are local and need deployment and staging confirmation. This follow-up performed no database operations and ran no commit hooks.

## Later retirement of legacy support

After staging confirms compatibility, separately plan a resumable background normalization job with original-value backups, conflict protection, and coverage of drafts, versions, translations, submissions, imports, and restored backups. Do not implement or run that job in this phase. Remove legacy conversion only after migration and remaining input paths have been verified.
