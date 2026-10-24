# Learner "assignment load" route inventory (NestJS → Rust port spec)

Source checkout: `/Users/freelove/mark-rust` (branch `master-rust`, HEAD `1dacc860`, same app code as `master`).
All paths below are relative to that checkout. Line numbers are from HEAD.

Scope: everything the learner web app calls from opening `/learner/:assignmentId`
(LTI launch done, `authentication` cookie present) until the first question renders,
plus attempt start/resume (create, resume, abandon-stale). Excluded: autosave
(`POST .../questions/:qid/responses`), submit (`PATCH .../attempts/:id`), grading
SSE, chat, uploads, on-demand question translation (`POST .../questions/:id/translations`),
success page.

---

## 0. Cross-cutting facts that apply to every route below

### 0.1 Topology and URL shape
- Browser (client-side) calls are same-origin `/api/v{1,2}/...`; Next rewrites
  `/api/:path*` → `${API_GATEWAY_HOST}/api/:path*` (`apps/web/next.config.js:34-41`).
  Exception: Next's own route handlers (`/api/error-report`, `/api/markChat`, `/api/transcribe`, `/api/github/callback`) win over the rewrite; none are on this path.
- SSR calls (React Server Components) go straight to `${API_GATEWAY_HOST}` (`apps/web/lib/utils.ts:28-37` `absoluteUrl`; `apps/web/lib/api-client.ts:149-158`), forwarding the browser's raw `Cookie` header manually.
- API base for these calls is v2 (`apps/web/config/constants.ts:10,32-63`), except `getUser`, which is hard-coded to `/api/v1/user-session` (`apps/web/lib/shared.ts:179`), and `ai-status` (v1).
- Gateway: `apps/api-gateway/src/main.ts:39-49` global prefix `api`, URI versioning, `cookieParser`. Everything learner-facing hits the catch-all `@All("/{*splat}")` with `DynamicJwtCookieAuthGuard` (`apps/api-gateway/src/api/api.controller.ts:137-163`). No path rewriting: downstream URL = `MARK_API_ENDPOINT + request.originalUrl` (`apps/api-gateway/src/api/api.service.ts:112-160`), origin pinned by `assertConfiguredOrigin`.
- API: `apps/api/src/main.ts:85-126` prefix `api`, URI versioning, helmet, cookieParser, global `ValidationPipe({whitelist:true})`, global `RolesGlobalGuard`, global `SerializeDatesInterceptor`; plus `CommonModule` registers global `DataTransformInterceptor` (APP_INTERCEPTOR) and `AllExceptionsFilter` (APP_FILTER) (`apps/api/src/common/common.module.ts:9-25`).

### 0.2 Gateway authentication (cookie, never bearer, on this path)
`apps/api-gateway/src/auth/jwt/cookie-based/jwt.cookie.strategy.ts` + `jwt.cookie.extractor.ts`:
1. Token selection (`jwt.cookie.extractor.ts:84-139`):
   - Context = `x-mark-{author|learner}-assignment: <posint>` header, else derived from `Referer` path `/(author|learner)/<id>` (+ `?authorMode=true` → author) (`:9-34`). Context *selects* a token, never grants.
   - If context present and a scoped cookie `mark_learner_<id>` (or `mark_author_<id>`) exists, and its unverified `userID` equals the current `authentication` cookie's `userID`, use the newest-`iat` among scoped (+ current if it matches role/assignment). Otherwise fall back to `authentication`.
   - Multiple `authentication` cookies (LTI 1.1 Lax vs 1.3 Partitioned jars): pick newest decodable `iat`.
2. passport-jwt verifies signature (HS256, `SECRET`) and `exp`.
3. `validate()` (`jwt.cookie.strategy.ts:82-226`), throws 401 `"Relaunch this quiz in the requested role"` when:
   - payload.role is author and the route's `/assignments/<id>` ≠ payload.assignmentID; or
   - a context exists and payload.role ≠ context.role, or payload.assignmentID ≠ context.assignmentId, or route id ≠ context.assignmentId.
   - NOTE: a **learner** token with **no** context header/referer is *not* checked against the route id at the gateway. The API guards (AssignmentGroup link) are the real authority.
   - Also re-verifies the current `authentication` cookie when a scoped cookie was selected (account switch / sign-out cannot be revived).
   - Side effect: sets/refreshes `mark_learner_<assignmentID>` (HttpOnly, SameSite=Lax, maxAge ≤ min(exp, 6h)), and evicts old scoped cookies beyond 4/role or 6 KiB total.
4. Returns `UserSession` (allow-listed): `userId, role, groupId, assignmentId, gradingCallbackRequired, returnUrl, launch_presentation_locale, lisOutcomeServiceUrl (printable ASCII only), toolConsumerInstanceGuid (/^[!-~]{1,255}$/), courseTitle, courseId, activityTitle (single-line ≤500), toolConsumerProductFamilyCode (≤255)` (`:197-225`).
- Non-prod `AUTH_DISABLED=true` swaps in `MockJwtCookieAuthGuard` which injects a fixed **author** session `{userId:"user@email.com", role:"author", groupId:"text-group-id", assignmentId:1, ...}` (`mock.jwt.cookie.auth.guard.ts`).

### 0.3 What the gateway forwards (`api.service.ts:112-160, 393-616`)
- Headers: all client headers (minus `host`, `content-length`) + `user-session: asciiJson(request.user)` + `Cache-Control: no-cache`. `asciiJson` (`:42-47`) = `JSON.stringify` with every char U+007F–U+FFFF escaped `\uXXXX` (undefined keys omitted). Client-supplied `user-session` is overwritten.
- `cookie`: rewritten by `dedupeAuthenticationCookieHeader` to a single `authentication=<selected token>` with all `mark_author_*`/`mark_learner_*` removed (`jwt.cookie.extractor.ts:152-180`). Not read by any load-path route.
- Body forwarded by axios; response body re-sent via `response.status(s).send(data)` — **downstream response headers are dropped** (content-type re-derived by Express). Non-2xx → `HttpException(downstreamBody, status)`; network failure → 500 `{"statusCode":500,"message":"Internal Server Error"}`.
- `Accept: text/event-stream` switches to raw http piping. Not used on this path.

### 0.4 API session middleware and role guard
- `UserSessionMiddleware` (`apps/api/src/auth/middleware/user.session.middleware.ts:24-56`) applies to `/v1/user-session`, `/v1/assignments*`, `/v2/assignments*` (and others; `apps/api/src/app.module.ts:44-60`). Missing header → 401 `Missing or invalid user session`; unparsable → 400 `Invalid user-session header`. **Header is trusted blindly**: the Rust API must only be reachable through the gateway.
- `RolesGlobalGuard` (`apps/api/src/auth/role/roles.global.guard.ts:27-70`): if `@Roles(...)` present, session.role must be in it, else `false` → Nest 403 `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}`.
- Session type: `apps/api/src/auth/interfaces/user.session.interface.ts:9-38` (`UserRole` = `"learner" | "author" | "admin"`; `userId` is an email string).

### 0.5 Response post-processing every route gets (wire-compat critical)
Interceptor order (verified in `@nestjs/core` interceptors-consumer + scanner): `DataTransformInterceptor` (registered first, outermost) wraps `SerializeDatesInterceptor` (inner). So per response: handler → dates to ISO → base64 encode.
1. `SerializeDatesInterceptor` (`apps/api/src/common/interceptors/serialize-dates.interceptor.ts`): every `Date` → `toISOString()` = `YYYY-MM-DDTHH:mm:ss.sssZ` (always 3 fractional digits, `Z`). Prisma `DateTime` columns are `timestamp(3)` without tz, interpreted as UTC.
2. `DataTransformInterceptor` (`apps/api/src/common/interceptors/data-transform.interceptor.ts:77-284`, field list `apps/api/src/helpers/transform-config.ts:11-35`). Default (no `@DataTransform` decorator, true for every route here): `encodeResponse: true, deep: true`. Walk every object key at every depth; a key is "configured" when
   - it equals a single-segment entry anywhere: `introduction, instructions, gradingCriteriaOverview, question, content, learnerTextResponse, learnerChoices`; or
   - its full path with array indices removed equals a multi-segment entry exactly: `choices.choice, choices.feedback, questions.choices.choice, questions.choices.feedback, questions.scoring.rubrics.rubricQuestion, questions.scoring.rubrics.criteria.description, questionVersions.choices.choice, questionVersions.choices.feedback, questionVersions.scoring.rubrics.rubricQuestion, questionVersions.scoring.rubrics.criteria.description, questionVersions.question`.
   For a configured key: if value is a string matching `/^\d+$/` after trim with length ≤ 10 → left as-is; else if array → string items base64'd, object items recursed, others untouched; else `base64(utf8(typeof v === "string" ? v : JSON.stringify(v)))` (standard alphabet, padded). Consequences: `null` → `"bnVsbA=="` (base64 of `"null"`), number `1` → `"MQ=="`, boolean → base64 of `"true"/"false"`. `undefined` values are skipped only because the keys concerned never hold `undefined` here (an `undefined` would throw in `Buffer.from`).
   Request side: decodes `body` and `query` for the same fields; `lang` is not a configured field, so it passes through.
3. Errors: `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts:74-190`): `HttpException` → `exception.getResponse()` body as-is; Prisma P2025→404, P2002→409, P2003→400, pool/lost-connection (P1001/P1008/P1017/P2024 or pooler message) → **503** `{"statusCode":503,"message":"Service temporarily unavailable"}` + `Retry-After: 1`; anything else 500 `{"statusCode":500,"message":"Internal server error"}`. The 503 matters: the web client retries 408/502/503/504 and network drops twice (1s, 2.5s ±20%) but never 500 (`apps/web/lib/api-retry.ts:9-31`).

### 0.6 Client-side decode (`apps/web/lib/api-client.ts:228-360`, `apps/web/app/Helpers/data-transformer.ts`, `apps/web/app/Helpers/transform-config.ts`)
Applies to every call made via `apiClient` (getAssignment, getAttempts, createAttempt, getAttempt, abandonAttempt, getAiStatus); **not** to `getUser` or `getSupportedLanguages` (plain `fetch`).
- Any string at any key that `JSON.parse`s to an object/array is replaced by the parsed value (and recursed). Primitive JSON (`"12"`, `"true"`, `"null"`) stays a string. This silently turns e.g. `randomizedChoices: "[...]"` into an array and JSON-string `learnerResponse` into objects/arrays.
- Configured fields (same list as the API) are base64-decoded if: ≥4 chars, `/^[A-Za-z0-9+/]+=*$/`, decodes to ≥85% printable UTF-8, and re-encodes to the same string; up to 5 layers; `comp:`-prefixed values are decompressed. Decoded text that parses to an object/array is parsed (except for array items).
- Requests: apiClient also base64-encodes configured fields in request bodies (none of the load-path requests carry bodies).
- apiClient adds `authorSessionHeaders()` on every request: on `/learner/<id>` pages that is `x-mark-learner-assignment: <id>` (or author variant with `?authorMode=true`) (`apps/web/lib/author-session.ts:8-31`).

---

## (A) Call sequence

Legend: SSR = Next server component (Cookie forwarded explicitly), CSR = browser.

### A.1 About page `/learner/:id` (`apps/web/app/learner/[assignmentId]/page.tsx`, `AuthFetchToAbout.tsx`, `(components)/AboutTheAssignment/index.tsx`, `(components)/Header.tsx`)
| # | Side | Method + path | Purpose |
|---|---|---|---|
| 1 | SSR | `GET /api/v1/user-session` (+`x-mark-learner-assignment`) | Resolve role/lmsHost; 401 → SessionExpired screen (`page.tsx:19-22`) |
| 2 | CSR | `GET /api/v1/ai-status` | Global layout UX hint (chat widget); fires on every route (`apps/web/components/LayoutContent.tsx:36-46`) |
| 3 | CSR | `GET /api/v2/assignments/:id?lang=<url lang or "en">` | Assignment metadata for About page (`AuthFetchToAbout.tsx:66-71`) |
| 4 | CSR | `GET /api/v2/assignments/:id/attempts` | Learner's own attempts → Begin/Resume/attempts-left/cooldown (`AuthFetchToAbout.tsx:73`); sequential after #3 |
| 5 | CSR | `GET /api/v2/assignments/:id/languages` | Language picker (`AboutTheAssignment/index.tsx:163-185`) |
| 6 | CSR | `GET /api/v2/assignments/:id/languages` (again) | Header language menu (`Header.tsx:166`) |
| 7 | CSR | `GET /api/v1/user-session` ×2 | Header role/returnUrl + LTI locale (`Header.tsx:173,181` → `stores/learner.ts:783-791`) |
| 8 | CSR | repeat #3 and #4 | On language confirm (`AboutTheAssignment/index.tsx:270-293`) and whenever `lang` in URL changes |

"Begin"/"Resume" (`BeginTheAssignmentButton.tsx`) does a full navigation (`window.location.href`) to `/learner/:id/questions?lang=<lang>` (`AboutTheAssignment/index.tsx:300-314`). No API call by itself.

### A.2 Questions page `/learner/:id/questions?lang=xx` (`questions/page.tsx` → `questions/LearnerLayout.tsx`)
| # | Side | Method + path | Purpose |
|---|---|---|---|
| 9 | SSR | `GET /api/v1/user-session` (+context header) | Role check; authors without `authorMode` get a 403 modal (`LearnerLayout.tsx:133-168`) |
| 10 | SSR | `GET /api/v2/assignments/:id/attempts` (+`x-mark-learner-assignment`) | Find in-progress attempt by **client clock** (`LearnerLayout.tsx:176-196`) |
| 11 | SSR | `POST /api/v2/assignments/:id/attempts` (no body) | Only when #10 had no in-progress attempt: create-or-resume (`LearnerLayout.tsx:206-248`) |
| 11b | SSR | `GET /api/v2/assignments/:id/attempts` | Only if #11 returned 422 `ATTEMPT_IN_PROGRESS`: re-list and resume (`LearnerLayout.tsx:208-236`) |
| 12 | SSR | `GET /api/v2/assignments/:id/attempts/:attemptId?lang=<url lang or "en">` | Attempt + questions for render (`LearnerLayout.tsx:342-348`) |
| 13 | CSR | `GET /api/v2/assignments/:id?lang=<store lang>` | Always fires: the v2 attempt response has no `assignmentDetails`/`name`, so `buildAssignmentDetailsFromAttempt` returns undefined (`(components)/Question/index.tsx:270-306,366-375`). Supplies `questionDisplay`, `questionControls`, `requireAllQuestions`, `optionalQuestionIds`, `name` |
| 14 | CSR | `GET /api/v2/assignments/:id/languages`, `GET /api/v1/user-session` ×2–3 | Header + Timer (`Header.tsx:159-196`, `Question/Timer.tsx:123-131`) |
| 15 | CSR | `GET /api/v2/assignments/:id/attempts/:attemptId?lang=<store lang>` | Header "reconcile" refetch when no question has `translations[lang]` (`Header.tsx:205-251`). Because the API strips `en` from `translations`, this **always** fires for English learners (once per attempt+lang) |
| 16 | CSR | `GET /api/v1/ai-status` | Global layout (and `questions/ClientComponent.tsx:84`, author preview only) |
| 17 | CSR | `POST /api/v2/assignments/:id/attempts/:attemptId/abandon` (`{}` body) | Only on learner click in `VersionMismatchBanner` (shown when `versionMismatch === true` and no `questionResponses`); then `router.refresh()` re-runs #9–#12 (`(components)/VersionMismatchBanner.tsx:20-34`, `Question/index.tsx:516-519`) |

Not on this path (excluded by scope but visible in network tab): chat widget calls, `POST .../questions/:qid/translations` (only when a learner toggles per-question translation, `QuestionContainer.tsx:194-231`), autosave.

---

## (B) Route details

### B.1 `GET /api/v1/user-session`
- Frontend: `getUser` `apps/web/lib/shared.ts:2181-2209`. Plain `fetch`, `cache: "no-store"`. Headers: `authorSessionHeaders(false)` (CSR only) or explicit `x-mark-<role>-assignment` (SSR), `Cookie` (SSR). 401 → `APIError(401)`; other non-OK → `Error(body.message)`.
- Gateway: catch-all, cookie auth.
- API: `apps/api/src/api/api.controller.ts:40-64` (v1 only). No `@Roles`; middleware required. No DB.
- Response (`ClientUserSession`, `user.session.interface.ts:9-17`): `{ userId, role, assignmentId, returnUrl?, launch_presentation_locale?, lmsHost? }`. `lmsHost` = hostname of `lisOutcomeServiceUrl`, lower-cased, leading `www.` stripped (`apps/api/src/common/portal/portal-context.ts:164-169`). Undefined keys omitted.
- UI reads: `role`, `lmsHost` (About, promo banner), `returnUrl` (Header), `launch_presentation_locale` (language default), `assignmentId` (`/learner` index redirect).
- Port note: trivially portable; it is not under `/v2/assignments`, so decide whether the Rust service takes it at all (it is a v1 path).

### B.2 `GET /api/v1/ai-status` (ambient)
- API: `apps/api/src/api/ai-feature-flags/ai-status.controller.ts:17-27`. No middleware, no roles. Gateway still requires a valid cookie.
- Response `{ grading: bool, chat: bool, authoring: bool }` from env flags `AI_FEATURES_DISABLED` (master), `AI_GRADING_DISABLED`, `AI_CHAT_DISABLED`, `AI_AUTHORING_DISABLED` (`ai-feature-flags.constants.ts:20-25`).

### B.3 `GET /api/v2/assignments/:id` (learner view)
- Frontend: `getAssignment` `apps/web/lib/shared.ts:2218-2254` via apiClient with `withTransientRetry`, header `Cache-Control: no-cache`; `?lang=` appended when a language is given (About page always passes one, default `"en"`; Question page passes store language or none). Strips `success` from the body.
- API: `AssignmentControllerV2.getAssignment` `apps/api/src/api/assignment/v2/controllers/assignment.controller.ts:179-209`.
  - `@Roles(AUTHOR, LEARNER)`, `@UseGuards(AssignmentAccessControlGuard)`, `@Param("id", ParseIntPipe)` (non-integer → 400 `"Validation failed (numeric string is expected)"`; note guards run before pipes), `@Query("lang")`.
- Guard `AssignmentAccessControlGuard` (`apps/api/src/api/assignment/guards/assignment.access.control.guard.ts:34-194`):
  - id = `Number(params.assignmentId) || Number(params.id) || session.assignmentId`; falsy/NaN → 403 `Invalid assignment ID`.
  - Author with `session.assignmentId !== id` → 403.
  - `$transaction([assignmentGroup.findFirst({assignmentId:id, groupId:session.groupId}), assignment.findUnique({id})])`.
  - No assignment → 404 `Assignment not found`.
  - No group link: if `session.assignmentId === id` and `groupId` non-empty string → **writes** `AssignmentGroup{assignmentId:id, groupId}` with `Group` `connectOrCreate {id: groupId}` (P2002 race swallowed) and allows; else 403 `Access denied to this assignment`.
  - Learners are *not* required to have `session.assignmentId === id`; any assignment linked to their group is readable.
  - No `published` check.
- Service: `AssignmentServiceV2.getAssignment` `apps/api/src/api/assignment/v2/services/assignment.service.ts:130-147` → `AssignmentRepository.findById` → optional `TranslationService.applyTranslationsToAssignment`.
- Repository `findById` (`apps/api/src/api/assignment/v2/repositories/assignment.repository.ts:223-336`):
  - `assignment.findUnique({ where:{id}, include:{ currentVersion:{include:{questionVersions:true}}, versions:{where:{isActive:true}, include:{questionVersions:true}, orderBy:{id:"desc"}, take:1}, questions:{where:{isDeleted:false}, include:{variants:true}} } })`. Missing → 404 `Assignment with Id <id> not found.`
  - Active version = `currentVersion` if `isActive`, else newest active version, else none (`pickActiveVersion` `:96-104`).
  - With an active version: `FIELDS` (`:24-53`) are merged version → base row → `DEFAULTS` (`:58-72`; `attemptsBeforeCoolDown 1, retakeAttemptCoolDownMinutes 5, passingGrade 50, questionDisplay ONE_PER_PAGE, graded false, numAttempts -1, showAssignmentScore/showQuestionScore/showSubmissionFeedback/showQuestions true, showPassFailIndicator false, requireAllQuestions false, optionalQuestionIds []`); "prefer" = first non-null (so `false`/`0` from the version win). `questionOrder` = version's if non-empty else base's. Questions rebuilt from `questionVersions` sorted by `displayOrder` then `id`, `id = qv.questionId ?? -qv.id`.
  - Without an active version: raw row, no defaults merged.
  - `processAssignmentData` (`:462-508`) JSON round-trips, filters deleted questions/variants, parses `scoring/choices/videoPresentationConfig`, applies `questionOrder`.
  - Learner branch (`:313-319`): `{ ...processedAssignment, success: true, questions: undefined }`.
- Translation (`apps/api/src/api/assignment/v2/services/translation.service.ts:827-870`): skipped when `lang` is not a string (repeated param) or its family is `en`. Otherwise `assignmentTranslation.findUnique({assignmentId_languageCode:{assignmentId, languageCode: lang}})` — **exact code match, no family fallback** (unlike questions) — and overwrites `name/introduction/instructions/gradingCriteriaOverview` with the non-empty `translated*` columns.
- Response shape (learner), DTO `LearnerGetAssignmentResponseDto` `apps/api/src/api/assignment/dto/get.assignment.response.dto.ts:43-50` (loose; real shape is the Prisma row):
  - All `Assignment` scalar columns: `id, name, introduction, instructions, gradingCriteriaOverview, timeEstimateMinutes, attemptsBeforeCoolDown, retakeAttemptCoolDownMinutes, type, graded, numAttempts, allotedTimeMinutes, requireAllQuestions, optionalQuestionIds, attemptsPerTimeRange, attemptsTimeRangeHours, passingGrade, displayOrder, questionDisplay, numberOfQuestionsPerAttempt, questionOrder, published, showAssignmentScore, showQuestionScore, showSubmissionFeedback, showQuestions, showPassFailIndicator, correctAnswerVisibility, questionControls, updatedAt, languageCode, currentVersionId` (version-merged where applicable), `success: true`.
  - **Also** `currentVersion` (full `AssignmentVersion` incl. `questionVersions[]` with `answer`, `choices` incl. `isCorrect/points/feedback`, `scoring` incl. rubrics, `authorComment`) and `versions` (0–1 element, same shape). These come from spreading the Prisma result (`:298-306`, `:323-326`) and are not stripped for learners. See (D)/(E): a learner answer-key leak.
- UI reads (About + Question page store): `name, introduction, instructions, gradingCriteriaOverview, allotedTimeMinutes, timeEstimateMinutes, numAttempts, attemptsBeforeCoolDown, retakeAttemptCoolDownMinutes, passingGrade, id, graded, published, questionControls{disableCopy,disablePaste,disableRightClick,disablePrint}, questionDisplay, requireAllQuestions, optionalQuestionIds` (`AboutTheAssignment/index.tsx:113-127, 490-520`, `Question/index.tsx:540-585`, `Header.tsx:124-131`). Nothing in the learner app reads `currentVersion`/`versions` (only the unused `getAssignmentVersionInfo`, `apps/web/lib/learner.ts:1197-1245`).
- Wire encoding: `introduction`, `instructions`, `gradingCriteriaOverview` base64 (incl. `null` → `"bnVsbA=="`); same keys inside `currentVersion`/`versions[0]`; every `question` key inside `questionVersions[]`. `name` is **not** encoded.

### B.4 `GET /api/v2/assignments/:id/languages`
- Frontend: `getSupportedLanguages` `apps/web/lib/shared.ts:2279-2297`, plain `fetch`, no custom headers (gateway context comes from the browser `Referer`), no retry, no decode. Throws if `!res.ok` or `!data.languages`.
- API: `assignment.controller.ts:566-591`. `@Roles(LEARNER, AUTHOR)`, `ParseIntPipe`, **no access guard**.
- Service: `translation.service.ts:601-617`: `assignmentTranslation.findMany({where:{assignmentId}, select:{languageCode}})`, add `"en"`; returns DB order then `"en"` if absent. Does not check the assignment exists (unknown id → `["en"]`).
- Response `{ languages: string[] }`. UI sorts by display name.

### B.5 `GET /api/v2/assignments/:assignmentId/attempts` (list)
- Frontend: `getAttempts` `apps/web/lib/author.ts:623-664` via apiClient, `withTransientRetry`, `quiet`; optional `x-mark-learner-assignment`. Each item passed through `normalizeAttemptTimestamps` (`apps/web/app/learner/utils/attempts.ts:170-...`): ISO-normalises `createdAt/expiresAt/updatedAt`; synthesises `expiresAt = createdAt + fallbackMinutes` for unsubmitted attempts with null `expiresAt` when a fallback is given (About page passes `assignment.allotedTimeMinutes`; SSR passes none).
- API: `AttemptControllerV2.listAssignmentAttempts` `apps/api/src/api/attempt/attempt.controller.ts:142-171`. `@Roles(LEARNER, AUTHOR)`, `@UseGuards(AssignmentAttemptAccessControlGuard)`.
- Guard `AssignmentAttemptAccessControlGuard` (`apps/api/src/api/assignment/attempt/guards/assignment.attempt.access.control.guard.ts:63-288`), for routes without `:attemptId`:
  - `assignmentId` strict positive integer string (`String(Number(x)) === x`) else 403 `Invalid assignment ID`.
  - `$transaction([assignment.findUnique({id}), assignmentGroup.findFirst({assignmentId, groupId: session.groupId})])`.
  - No assignment → 404. No group link → `false` (403). **No self-heal here** (unlike B.3).
- Service `apps/api/src/api/attempt/services/attempt.service.ts:668-678`: `assignmentAttempt.findMany({ where: role===AUTHOR ? {assignmentId} : {assignmentId, userId: session.userId} })` — no `orderBy`, no `select`.
- Response: array of raw `AssignmentAttempt` rows: `id, assignmentId, assignmentVersionId, userId, submitted, grade, expiresAt, createdAt, questionOrder, comments, preferredLanguage` (`apps/api/prisma/schema.prisma:532-560`). DTO (partial) `AssignmentAttemptResponseDto` `apps/api/src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto.ts:14-71`. `grade` is returned even when `showAssignmentScore` is false.
- UI reads: `id, submitted, expiresAt, createdAt, updatedAt` (never present; model has no `updatedAt`). In-progress = `!submitted && (expiresAt == null || now < expiresAt)` by **device clock** (`attempts.ts:83-90`); latest = max `createdAt`, tie → max `id` (`:92-121`). About page: `attempts.length >= numAttempts` → completed; cooldown countdown from latest submitted attempt (`AboutTheAssignment/index.tsx:189-266`).

### B.6 `POST /api/v2/assignments/:assignmentId/attempts` (create or resume)
- Frontend: `createAttempt` `apps/web/lib/learner.ts:50-127`. SSR only, apiClient, no body, headers `Content-Type`, `Cookie`, `x-mark-learner-assignment`. Not retried. Maps errors by duck-typed `status` and `body.code`:
  - body.code `AI_TEMPORARILY_DISABLED` (409) → "ai temporarily unavailable"; 422+`ATTEMPT_IN_PROGRESS` → "attempt in progress"; 422+`ATTEMPT_TIME_RANGE_EXCEEDED` → "time range exceeded"; any other 422 → "no more attempts"; 429 → "in cooldown period"; else `undefined` → "Attempt could not be created" 500 modal (`LearnerLayout.tsx:33-112, 268-309`).
  - On success reads only `{ success, error, id }`; `success !== true` → treated as failure.
- API: `AttemptControllerV2.createAssignmentAttempt` `apps/api/src/api/attempt/attempt.controller.ts:86-112`. `@Roles(LEARNER)` (authors 403), `AssignmentAttemptAccessControlGuard` (same as B.5: group link required, no heal). Nest `@Post` default status **201**.
- Service: `AttemptSubmissionService.createAssignmentAttempt` `apps/api/src/api/attempt/services/attempt-submission.service.ts:189-286`:
  1. Fast path: `findResumableAttempt` (`:294-309`) = `assignmentAttempt.findFirst({ where: activeAttemptWhere, orderBy:{createdAt:"desc"} })` with `activeAttemptWhere = {assignmentId, userId, submitted:false, OR:[{expiresAt:null},{expiresAt:{gte: now}}]}` (`attempt-validation.service.ts:33-44`). Found → `{id, success:true, serverNow}` (no other checks, kill switch not consulted).
  2. Load `assignment.findUnique({ include:{ currentVersion:{include:{questionVersions:true}}, questions:{where:{isDeleted:false}, include:{variants:{where:{isDeleted:false}}}} } })`; missing → 404. **The settings used below are the raw base `Assignment` row, not version-merged** (`assignmentForAttemptFlow = {...assignment, success:true}`).
  3. Interactive transaction `{maxWait:5000, timeout:15000}`:
     - `SELECT pg_advisory_xact_lock(hashtextextended('<userId>:<assignmentId>', 0))` (`:251`).
     - Re-check `findResumableAttempt` under lock → resume if found (logs warn).
     - `validateNewAttempt` (`apps/api/src/api/attempt/services/attempt-validation.service.ts:63-177`), in order:
       a. Kill switch (`apps/api/src/api/ai-feature-flags/grading-kill-switch.service.ts:36-82`): if GRADING disabled (or ALL) **and** `question.findFirst({assignmentId, type in [TEXT, URL, UPLOAD]})` (live `Question` table, `isDeleted` not filtered) → 409 `{statusCode:409, code:"AI_TEMPORARILY_DISABLED", message:"This activity is temporarily out of service. Please try again later."}`.
       b. Active attempt exists → 422 `{statusCode:422, code:"ATTEMPT_IN_PROGRESS", message:"A attempt is already in progress and has not expired."}` (unreachable after the lock re-check except by race with the clock).
       c. If `attemptsPerTimeRange` truthy: count attempts with `createdAt ∈ [now - attemptsTimeRangeHours h, now]` (window start = now if hours unset → count ≈ 0); `>= attemptsPerTimeRange` → 422 `{code:"ATTEMPT_TIME_RANGE_EXCEEDED", message:"You have exceeded the allowed number of attempts within the specified time range."}`.
       d. If `numAttempts !== null && numAttempts !== -1`: total = count(userId, assignmentId) (all attempts, submitted or not); `>= numAttempts` → 422 `{code:"ATTEMPT_MAX_REACHED", message:"Maximum number of attempts reached for this assignment."}`. Then cooldown **only inside this branch**: if `attemptsBeforeCoolDown(??1) > 0 && retakeAttemptCoolDownMinutes(??0) > 0 && total >= attemptsBeforeCoolDown`: last submitted attempt ordered `expiresAt desc, createdAt desc` (Postgres puts NULLs first on DESC); ref = `expiresAt ?? createdAt`, clamp to ≤ now; `now < ref + cooldown` → 429 `{statusCode:429, message:"You must wait some time before creating a new attempt for this assignment"}` (no `code`).
     - `createAttemptWithQuestions` (`:311-495`):
       1. `expiresAt = allotedTimeMinutes > 0 ? now + allotedTimeMinutes min : null` (`:1931-1941`, base row value).
       2. `assignmentAttempt.create({ expiresAt, submitted:false, assignmentId, assignmentVersionId: assignment.currentVersionId, userId: session.userId, questionOrder: [] })`. **Version pinning = `Assignment.currentVersionId` as-is**, even if that version is not `isActive` (differs from B.3's `pickActiveVersion`).
       3. Seeds: `selectionSeed = attemptId ^ assignmentId` (int32 XOR); `orderingSeed = Math.imul(selectionSeed, 2654435761) >>> 0` (u32 wrapping multiply).
       4. Question pool: if `currentVersion.questionVersions` non-empty → one DTO per QuestionVersion with `id = qv.questionId || qv.id`, variants = live non-deleted `QuestionVariant`s of `qv.questionId`; else live non-deleted `Question`s with their non-deleted variants.
       5. Subset: if base `numberOfQuestionsPerAttempt > 0` → `deterministicShuffle(pool, selectionSeed).slice(0, min(n, pool.length))` (oversized n is clamped, logged).
       6. Normalise DTOs (choices/scoring parsed with defaults `[]` / `{type:"CRITERIA_BASED", showRubricsToLearner:false, rubrics:[]}`; `answer` bool or `"true"/"false"` → bool).
       7. Order (`getOrderedQuestions` `:1946-2016`): base `displayOrder === "RANDOM"` → `deterministicShuffle(questions, orderingSeed)`; else if base `questionOrder` non-empty → `applyQuestionOrder` (listed ids first in that order, unknown ids dropped, remaining in original order; `apps/api/src/api/assignment/utils/question-order.util.ts`).
       8. `assignmentAttempt.update({ questionOrder: ordered ids })`.
       9. `createAttemptQuestionVariants` (`apps/api/src/api/attempt/services/question-variant/question-variant.service.ts:20-62`): per question, pick uniformly at random (`Math.random`, not seeded) from `[base, ...variants]`; `randomizedChoices = JSON.stringify(choices)` of the chosen source (variant's or question's), shuffled with `sort(() => Math.random() - 0.5)` only when that source's `randomizedChoices === true`; null/unparsable choices → `[]` → stored `"[]"`; non-array JSON → `null`. `createMany` into `AssignmentAttemptQuestionVariant{assignmentAttemptId, questionId, questionVariantId|null, randomizedChoices}`. The column is `Json`, and the value written is a **JSON string containing JSON**.
     - `deterministicShuffle` (`:2019-2031`): Fisher–Yates from the end with LCG `s = (s*9301 + 49297) % 233280`, `j = floor(s/233280 * (i+1))`; `seed || 1`. Must use exact integer arithmetic (product < 2^53 in JS; use u64/i64 in Rust).
- Response: `BaseAssignmentAttemptResponseDto` (`apps/api/src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto.ts`): `{ id: number, success: true, serverNow: ISO string }` (`readServerClock`, `apps/api/src/api/assignment/attempt/helper/server-clock.helper.ts:10`).

### B.7 `GET /api/v2/assignments/:assignmentId/attempts/:attemptId?lang=`
- Frontend: `getAttempt` `apps/web/lib/learner.ts:231-299`. apiClient, `withTransientRetry`, quiet; headers `Cookie` + `x-mark-learner-assignment` on SSR. Always sends `?lang=` (default `"en"`). Post-processing: `normalizeAttemptTimestamps(attempt, attempt.assignmentVersion?.allotedTimeMinutes ?? attempt.assignmentDetails?.allotedTimeMinutes ?? attempt.assignment?.allotedTimeMinutes ?? null)`; stamps `question.contentLanguage = lang`. SSR caller rethrows 401/403 (`throwOnAuthError`), any other failure → "Attempt could not be fetched" 500 modal.
- API: `AttemptControllerV2.getAssignmentAttempt` `apps/api/src/api/attempt/attempt.controller.ts:173-189`. `@Roles(LEARNER, AUTHOR)`, `AssignmentAttemptAccessControlGuard`:
  - `attemptId` strict positive int else 403 `Invalid attempt ID`.
  - Learner session without non-empty `userId` → 403.
  - Transaction adds `assignmentAttempt.findFirst({ id: attemptId, assignmentId, userId: <learner userId> })` (authors: no userId filter).
  - No group link: allowed **only** for `GET/HEAD` when the attempt row's `userId === session.userId` (logged warn); else 403.
  - Learner and attempt not owned / not found → 404 `Attempt not found or not owned by the user`.
- Service: `AttemptServiceV2.getAssignmentAttempt` (`attempt.service.ts:761-767`, ignores the session) → `AttemptSubmissionService.getAssignmentAttempt` `attempt-submission.service.ts:943-1112`:
  1. `language = lang?.trim().toLowerCase() || "en"` (`:2254-2256`, keeps region, e.g. `zh-cn`). A repeated `lang` (array) would throw → 500.
  2. `assignmentAttempt.findUnique({ id, include:{ questionResponses:true, questionVariants:{include:{questionVariant:{include:{variantOf:true}}}}, assignmentVersion:{include:{questionVersions:true}} } })`; missing → 404.
  3. `assignment.findUnique({ id: attempt.assignmentId, select:{ questionOrder, displayOrder, passingGrade, showAssignmentScore, showSubmissionFeedback, showQuestions, showQuestionScore, updatedAt, currentVersionId, currentVersion:{select:{correctAnswerVisibility:true}} } })` (base row values, except `correctAnswerVisibility` from current version, default `"NEVER"` if no current version).
  4. Question source (`AttemptAccessCacheService.getQuestionDtosForAttemptAccess`, `apps/api/src/api/attempt/services/attempt-access-cache.service.ts:64-110`): if the attempt has `assignmentVersionId` → the **pinned** version's `questionVersions` (`id = qv.questionId || qv.id`); else live `question.findMany({assignmentId, isDeleted:false})`. Each mapped by `toEnhancedAttemptQuestionDto` (`:267-312`): `answer` → string, `randomizedChoices` → string (`JSON.stringify(bool ?? false)` when not a string), choices/scoring/video/live parsed with defaults, `maxWords/maxCharacters` `|| undefined`. Redis cache (TTL 600 s) key `mark:attempt-access:version:<versionId>` or `mark:attempt-access:assignment:<assignmentId>:<updatedAt ms>`; empty results never cached; invalidated on publish/restore (`assignment.service.ts:864`, `version-management.service.ts:820`). Shared with the completed-attempt route (`attempt-submission.service.ts:691`).
  5. Translations (`apps/api/src/api/attempt/services/translation/translation.service.ts:103-196`): family = `lang.split("-")[0]`; `translation.findMany({ where:{ languageCode:{startsWith: family, mode:"insensitive"}, OR:[{questionId in ids}, {variantId in chosen variant ids}] } })`; map key `variant-<variantId>` if `variantId` else `question-<questionId>`, value `{ [languageCode]: {translatedText, translatedChoices} }`; then synthesises an `en` entry from authored text/choices for every question/variant lacking one.
  6. `AttemptQuestionsMapper.buildQuestionsWithTranslations` (`apps/api/src/api/attempt/common/utils/attempt-questions-mapper.util.ts:215-420`):
     - For each `AssignmentAttemptQuestionVariant` row whose `questionId` is in the source list: drop every `en*` key from that question's and variant's translation maps (`withoutAuthoredLanguage` `:433-445`); pick translation via `pickTranslation` (`translation-language.util.ts:9-21`: exact code (case-insensitive) → base code → any code in the family, codes sorted) — variant's first, then question's; fall back to authored text/choices.
     - Base choices = variant choices (if variant and non-empty) else question's. If `randomizedChoices` present: permutation = position of each randomized choice in base choices, matched by `id` if present else by `choice` text; if the permutation covers all choices the displayed order follows it; stored translations' `translatedChoices` (same length only) are reordered by the same permutation.
     - Choices are sanitised to `[{ id: number|null, choice: string }]` (numbers stringified; entries without string/number `choice` dropped) (`:487-501`) — `isCorrect`, `points`, `feedback` are removed here unconditionally.
     - `translations` object: every non-en code in the family → `{ translatedText, translatedChoices: sanitised array | null }`.
     - Question rows without an attempt-variant row are appended (authored/translated content). Final order = `attempt.questionOrder` (ids not in it are dropped); if `questionOrder` is empty (legacy) → variant rows first then the rest.
  7. `removeSensitiveData` (`:2093-2176`): `scoring.rubrics` deleted unless `scoring.showRubricsToLearner`; `authorComment = null`; choice `points` deleted; `isCorrect`/`feedback` deleted unless `shouldShowCorrectAnswers(visibility, attempt.grade||0, passingGrade)` (`:2261-2280`: `NEVER` false, `ALWAYS` true, `ON_PASS` → `grade >= passingGrade/100`, `pass-fail.util.ts:18-26`); same for `translations[*].translatedChoices`; `randomizedChoices` string parsed — array → points removed (+isCorrect/feedback per visibility) and re-stringified, non-array (e.g. `"false"`) → `"[]"`; `answer` deleted.
  8. `versionMismatch = attempt.assignmentVersionId != null && assignment.currentVersionId != null && they differ` (`:1087-1090`).
- Response (`GetAssignmentAttemptResponseDto`, `get.assignment.attempt.response.dto.ts:73-245`; actual object at `attempt-submission.service.ts:1097-1112`):
  - Spread of the **raw** attempt include: `id, assignmentId, assignmentVersionId, userId, submitted, grade, expiresAt, createdAt, questionOrder, comments, preferredLanguage`, `questionResponses[]` (raw rows: `id, assignmentAttemptId, questionId, learnerResponse, points, feedback, metadata, gradedAt`), `questionVariants[]` (raw rows incl. `randomizedChoices` and `questionVariant` + nested `variantOf` full `Question` row — unsanitised), `assignmentVersion` (full row incl. `questionVersions[]` — unsanitised; `null` for unpinned attempts).
  - Overrides/additions: `serverNow`, `grade` (null when `showAssignmentScore` false), `questions[]` (B.7.6/7), `passingGrade, showAssignmentScore, showSubmissionFeedback, showQuestionScore, showQuestions, correctAnswerVisibility, currentVersionId, versionMismatch`.
  - Per question: `id, question, choices[{id,choice}], translations{code:{translatedText, translatedChoices}}, authorComment:null, maxWords?, maxCharacters?, scoring?, totalPoints, type, assignmentId, gradingContextQuestionIds, responseType?, isDeleted, randomizedChoices (string), videoPresentationConfig, liveRecordingConfig`. No `answer`, no `variantId`, no `translationStatus` (v1-only), no per-question `questionResponses`.
  - No `name`, `assignmentDetails`, `questionControls`, `showPassFailIndicator`, `passed`, `totalPossiblePoints` on this route.
- UI reads: `id, expiresAt, createdAt, serverNow, submitted, questions[], questionResponses[]` (top-level; used to hydrate drafts on resume via latest response `learnerResponse`, `Question/index.tsx:384-414`), `versionMismatch`, `assignmentVersion.allotedTimeMinutes` (expiry fallback only). Per question: `id, type, question, choices, translations, scoring{showRubricsToLearner, rubrics, showPoints, showSubQuestionsToLearner}, responseType, totalPoints, maxWords, maxCharacters, videoPresentationConfig, liveRecordingConfig, randomizedChoices` (fallback for empty `choices`, `stores/learner.ts:937-957`).
- Wire encoding: `questions[].question`, `questions[].choices[].choice` (unless a ≤10-digit numeric string), `questions[].scoring.rubrics[].rubricQuestion`, `questions[].scoring.rubrics[].criteria[].description`, and every other key named `question` (`questionVariants[].questionVariant.variantOf.question`, `assignmentVersion.questionVersions[].question`). Not encoded: `translations.*.translatedText`, `translations.*.translatedChoices[].choice`, `randomizedChoices`, `learnerResponse`, `variantContent`.

### B.8 `POST /api/v2/assignments/:assignmentId/attempts/:attemptId/abandon`
- Frontend: `abandonAttempt` `apps/web/lib/learner.ts:210-224`, apiClient, body `{}`; any error → `false`.
- API: `attempt.controller.ts:114-140`. `@Roles(LEARNER, AUTHOR)`, `AssignmentAttemptAccessControlGuard` (ownership + group link required; POST is not read-only so no owner exemption). Status 201.
- Service `attempt-submission.service.ts:502-590`: `assignmentAttempt.findUnique({ select:{id,userId,assignmentId,assignmentVersionId,submitted,_count:{select:{questionResponses:true}}} })`; missing or (non-author and not owner) → 404 `Attempt <id> not found.`; submitted → 422 `This attempt has already been submitted.`; any responses → 422 `Cannot abandon an attempt that already has saved responses.`; `assignment.currentVersionId` null → 422 `This assignment has no active version.`; same version → 422 `Attempt is already pinned to the current version; no need to abandon.`; else **hard delete** `assignmentAttempt.delete` (cascades `AssignmentAttemptQuestionVariant`). Not transactional (check-then-delete).
- Response `{ id, success: true }`.

---

## (C) Prisma models touched

| Model (table) | Read | Write | Where |
|---|---|---|---|
| `Assignment` | guards (B.3/B.5–B.8), findById + includes (B.3), create (B.6), select (B.7), `currentVersionId` (B.8) | — | see B |
| `AssignmentGroup` (`@@id([assignmentId, groupId])`) | both guards | **create** (B.3 guard self-heal) | `assignment.access.control.guard.ts:141-194` |
| `Group` (`id @unique`) | — | **connectOrCreate** (B.3 self-heal) | same |
| `AssignmentVersion` | `currentVersion` / active `versions` (B.3), `currentVersion` (B.6), `attempt.assignmentVersion` + `currentVersion.correctAnswerVisibility` (B.7) | — | |
| `QuestionVersion` | via the above includes | — | |
| `Question` | include (B.3, B.6), kill switch `findFirst type in (TEXT,URL,UPLOAD)` (B.6), unversioned-attempt source (B.7), `variantOf` (B.7) | — | |
| `QuestionVariant` | include (B.3 non-deleted not filtered in include, filtered later; B.6 `isDeleted:false`), `questionVariant` (B.7) | — | |
| `AssignmentAttempt` | guard ownership, list (B.5), resumable/active/time-range/count/last-submitted (B.6), findUnique (B.7, B.8) | **create**, **update questionOrder** (B.6), **delete** (B.8) | |
| `AssignmentAttemptQuestionVariant` (`@@id([assignmentAttemptId, questionId])`, FK `questionId → Question.id`) | include (B.7) | **createMany** (B.6); cascade delete (B.8) | |
| `QuestionResponse` | include (B.7), `_count` (B.8) | — | |
| `AssignmentTranslation` (`@@unique([assignmentId, languageCode])`) | languages (B.4), lang overlay (B.3) | — | |
| `Translation` | B.7 (question/variant translations by language family) | — | |
| `FeedbackTranslation` | not touched on this path | — | |
| Postgres advisory lock | `pg_advisory_xact_lock(hashtextextended('<userId>:<assignmentId>',0))` | — | B.6 |
| Redis (cache conn) | `mark:attempt-access:*` | SET EX 600 | B.7 |

Enum spellings on the wire (`apps/api/prisma/schema.prisma`): `CorrectAnswerVisibility` NEVER|ALWAYS|ON_PASS; `QuestionType` TEXT|SINGLE_CORRECT|MULTIPLE_CORRECT|TRUE_FALSE|URL|UPLOAD|LINK_FILE; `ResponseType` REPO|CODE|ESSAY|REPORT|PRESENTATION|VIDEO|AUDIO|IMAGES|SPREADSHEET|LIVE_RECORDING|OTHER; `AssignmentType` AI_GRADED|MANUAL; `AssignmentQuestionDisplayOrder` DEFINED|RANDOM; `QuestionDisplay` ONE_PER_PAGE|ALL_PER_PAGE; `VariantType` REWORDED|RANDOMIZED|DIFFICULTY_ADJUSTED; `UserRole` learner|author|admin (lower-case).

---

## (D) Invariants the Rust implementation must preserve

Authorization and ownership
1. Trust only the gateway's `user-session` header; reject missing (401) / unparsable (400). Network-restrict the service to the gateway.
2. Role gates: list/get attempt: learner|author; create: learner only; abandon: learner|author; get assignment: learner|author; languages: learner|author. `admin` is rejected everywhere here.
3. Assignment-level access = `AssignmentGroup(assignmentId, session.groupId)` exists. GET assignment self-heals the link when `session.assignmentId === route id` and `groupId` is a non-empty string; attempt routes never heal. Authors must have `session.assignmentId === route id` (B.3 guard; gateway enforces for all author requests).
4. Attempt ownership for learners: row must match `(id, assignmentId from route, userId from session)`; a session without `userId` is refused before querying (never let an empty filter become "any learner"). Missing/unowned → 404, not 403.
5. Read-only owner exemption: a learner may GET their own attempt without a current group link; writes (create, abandon) always need the link.
6. Strict id parsing on attempt routes (`String(Number(x)) === x`, positive) → 403 on failure; `ParseIntPipe` semantics (400) on `/assignments/:id` and `/languages`.
7. Learners only ever list their own attempts (`userId` filter).

Attempt lifecycle
8. Create is idempotent per (userId, assignmentId): resume the newest active attempt (unsubmitted and `expiresAt` null or ≥ now) before and after taking the advisory lock; serialize creators with the same lock key so NestJS and Rust interoperate during the migration.
9. Validation order and codes: kill switch 409 `AI_TEMPORARILY_DISABLED` → in-progress 422 `ATTEMPT_IN_PROGRESS` → time-range 422 `ATTEMPT_TIME_RANGE_EXCEEDED` → max attempts 422 `ATTEMPT_MAX_REACHED` → cooldown 429 (no code). Body shapes as in B.6; the client keys on `status` + `body.code`.
10. Attempt limits count every attempt (submitted or not); cooldown applies only when `numAttempts` is limited and only after `attemptsBeforeCoolDown` attempts, measured from the last submitted attempt's `expiresAt ?? createdAt` clamped to now.
11. Time limit: `expiresAt = now + allotedTimeMinutes` at creation when > 0, else null; persisted once, never recomputed on read.
12. Version pinning: new attempt stores `assignmentVersionId = Assignment.currentVersionId`; reads use the **pinned** version's `QuestionVersion`s (unpinned legacy attempts use live non-deleted questions). `versionMismatch` exposed; abandon allowed only when pristine (unsubmitted, zero responses) and pinned version ≠ current version.
13. Question subset and order are fixed at creation and persisted in `AssignmentAttempt.questionOrder`; reads return questions strictly in that order. Seeds: `selectionSeed = attemptId XOR assignmentId`, `orderingSeed = u32(selectionSeed * 2654435761)`, LCG shuffle as specified (byte-identical results needed only if Rust and NestJS must agree on the same attempt id; they do not re-derive after creation, so exact parity is nice-to-have, not required).
14. Exactly one `AssignmentAttemptQuestionVariant` row per selected question, with the chosen variant (or null) and the choice order frozen in `randomizedChoices`; reads honor that order for authored and translated choices; grading later matches against it.
15. Creation is atomic: attempt row, `questionOrder` update and variant rows commit together.

Visibility / stripping for learners (on `questions[]`; see (E) for the parts NestJS leaks)
16. Never return `answer`, choice `isCorrect`/`feedback`/`points` unless `correctAnswerVisibility` allows (`ALWAYS`, or `ON_PASS` with `grade >= passingGrade/100`); `points` never. `authorComment` always null. `scoring.rubrics` only when `scoring.showRubricsToLearner === true`.
17. `grade` null when `showAssignmentScore` is false.
18. English is authored content: never serve stored `en*` Translation rows or `en` AssignmentTranslation rows; question translations select by language family with exact → base → sibling precedence; assignment-level translation is exact-code only.
19. Missing translation for a requested language falls back to authored content (no 500).

Wire compatibility
20. Base64-encode the configured fields exactly as `DataTransformInterceptor` does (section 0.5), including the ≤10-digit-numeric-string exemption and `null` → `"bnVsbA=="`; leave every other string verbatim.
21. ISO-8601 UTC with milliseconds for all timestamps; `serverNow` on create and get.
22. Error statuses 401/403/404/409/422/429 with Nest-shaped bodies; DB connectivity failures must be 503 (retried by the client), not 500.
23. `success: true` on GET assignment and POST create; POST routes answer 201.

---

## (E) Open questions / findings that could not be settled from code alone

1. **Answer-key leak in GET /v2/assignments/:id (learner).** The learner response still carries `currentVersion` and `versions[0]` with full `questionVersions` (answers, `isCorrect`, rubrics, author comments), because `findById` spreads the Prisma include (`assignment.repository.ts:298-306, 313-319`) and nothing strips it. No learner code reads these keys. Recommend Rust omits them; confirm with a staging curl through the gateway and decide whether to patch NestJS now.
2. **Answer-key leak in GET attempt.** The response spreads the raw attempt include (`attempt-submission.service.ts:1097-1112`): `assignmentVersion.questionVersions[]`, `questionVariants[].questionVariant.variantOf` (full `Question`), and `questionVariants[].randomizedChoices` (full choice objects incl. `isCorrect`/`feedback`/`points`) are not passed through `removeSensitiveData`, regardless of `correctAnswerVisibility`. Additionally `questions[].randomizedChoices` keeps `isCorrect`/`feedback` whenever visibility is `ALWAYS` (the schema default) even mid-attempt. The UI needs only `assignmentVersion.allotedTimeMinutes` and top-level `questionResponses`. Recommend a minimal, explicit response in Rust; confirm nothing else (e.g. Playwright or support tooling) depends on the leaked keys.
3. **Settings source mismatch.** Create (B.6) validates limits, cooldown, time limit, subset size and display order from the **base `Assignment` row**, while the About page shows **version-merged** values (B.3). Version restore only moves `currentVersionId` (`version-management.service.ts:782-785`), so they can diverge. Which is authoritative for Rust: the version, or keep base-row parity?
4. **Pinned version vs active version.** Create pins `currentVersionId` even when that version is not `isActive`; B.3 shows `pickActiveVersion`. Can `currentVersion.isActive = false` occur in prod? If so, learners could see one version's metadata and get another's questions.
5. **QuestionVersion rows with `questionId = null`.** Create and read use `qv.questionId || qv.id`; the FK `AssignmentAttemptQuestionVariant.questionId → Question.id` would then point at an unrelated question or fail. Does publish guarantee `questionId` is always set? (B.3 uses `-qv.id` for the same case.)
6. **Null text fields encode to `"bnVsbA=="`** and the client decodes them to the literal string `"null"` (it does not re-parse primitive JSON). Is `"null"` actually rendered for assignments with null `instructions`/`gradingCriteriaOverview`? Should Rust reproduce this byte-for-byte or emit `null` (the client tolerates `null`)?
7. **Unpublished assignments.** Neither GET assignment nor create checks `published`; only the UI blocks "Begin". Should Rust enforce `published` on create? (Behavior change.)
8. **Languages endpoint has no access guard** and never checks the assignment exists. Keep as-is or add the group check? (The plain-fetch caller sends no context header; the gateway's referer fallback is what binds it to a quiz.)
9. **Gateway does not bind learner tokens to the route id without a context header/referer.** All learner calls here send one (header or referer), but the API's group check is the only server-side boundary. Confirm this is acceptable for the Rust API too.
10. **Client-clock resume.** The questions page decides "resume vs create" with the device clock, and create resumes server-side anyway. With a skewed device clock, the client may call create for an attempt the server considers active (fine) or skip create for an attempt the server considers expired (then GET returns an expired attempt). Is the latter handled downstream (submit has a 30 s grace, `attempt-validation.service.ts:194-201`)?
11. **Redis attempt-access cache.** If Rust reads/writes `mark:attempt-access:*`, it must produce the exact `EnhancedAttemptQuestionDto` JSON that NestJS reads (and NestJS's publish invalidation must cover Rust keys). Simplest: Rust does not use this cache, or uses a separate key prefix.
12. **Header reconcile refetch** (A.2 #15) doubles the attempt read for every English learner because `en` is stripped from `translations`. Not a server concern, but it affects Rust load estimates.
13. **`updatedAt` on attempts** is read by the About page cooldown logic but the model has no such column; the client falls back to `expiresAt`/`createdAt`. Do not add it in Rust without checking the cooldown math.
14. **`lang` as an array** (`?lang=a&lang=b`) → 500 on GET attempt (`.trim` on an array), silently ignored on GET assignment. Rust should pick a defined behavior (first value, or 400).
15. **Advisory-lock key parity.** `hashtextextended(text, 0)` is a Postgres function; Rust calling the same SQL gives the same key. Confirm both services run against the same database during the migration so the lock actually serializes them.
16. **Base64 heuristics on the client** can mis-decode plain stored text that happens to be valid printable base64 (e.g. short words). Existing behavior; Rust must only match the server-side encoding to stay compatible.
