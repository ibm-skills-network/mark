# CM quiz publishing and author access

## Failure modes and fixes

A copied `/author/<Mark ID>/questions` URL does not establish an LTI author session. The old layout treated missing, expired, wrong-role and failed session checks alike and described all of them as a learner trying to edit. A single authentication cookie could also be replaced by a learner preview or another quiz launch. CM reused old launch signatures in its generation-result actions.

Mark now retains up to four verified author JWTs in HttpOnly cookies, selected for the requested author workspace. The ordinary current launch must still be present, valid and for the same user. Selected JWTs are signature/expiry checked, and the forwarded authentication cookie matches the selected session. Learner requests continue using the ordinary launch cookie. Author requests for another quiz are rejected independently of browser context headers; assignment and question guards enforce the author launch's assignment in the API as well. This preserves upstream collaborator authorization: AWB/CM must issue an authorized launch for the target quiz.

The editor checks its session before mounting and offers AWB recovery for a missing session. Recovery resolves the Mark ID plus provider to a separately numbered AWB assignment and checks existing AWB access policy. An already mounted editor retains unsaved state while access is unavailable; it does not reopen under another account. API-client requests carry the mounted editor's account identity so pending work cannot silently save under a replacement account.

AWB registration previously saved the assignment before linking the Mark group. A failure after that save, or a lost successful response, made a retry fail duplicate validation. The paired AWB change reuses the existing `(provider, Mark ID)` only for the same owner, retries group linking, preserves AWB edits, and rolls back a new registration if linking fails. The paired CM change derives the Mark ID from the authorized completed job and commits export result plus completion together. Fresh launch credentials are fetched on each click into a new tab; failure does not close or navigate an existing editor.

## Existing records

No schema migration is required in any of the three repositories. The existing unique index in AWB is reused.

Retry publishing an existing completed CM quiz through the supported UI. Same-owner registration returns the existing AWB assignment and repairs the Mark group link; missing registrations are created. No duplicate Mark quiz is needed. Ownership/provider conflicts are rejected rather than transferred. Quizzes never explicitly published are not automatically published, and existing incorrect ownership or missing job output needs separate investigation. A valid fresh launch is required to repair a browser's missing/expired session; deployment does not turn an old URL into a credential.

CM general assets support sharing through their holders, but the current generated-quiz job launch/export policies are job-owner scoped. AWB organization membership and existing assignment-holder permissions govern collaborative AWB launches. These changes do not add a new CM sharing policy. Already-issued JWTs retain their normal expiry; removing AWB membership prevents new launches but does not instantly revoke issued JWTs.

## Staging deployment and test playbook

Use only staging quizzes, accounts, providers, OAuth clients and signing configuration. Set Mark web `AWB_URL` to the staging AWB origin and `AWB_MARK_PROVIDER_ID` to the staging AWB provider for this Mark instance. Keep Mark quiz IDs and AWB primary keys distinct. Point CM's Mark and AWB connections and AWB's Mark provider at those same staging services. No LTI-gateway code change is required; the configured gateway must still validate/sign normal launches.

Deploy AWB first (registration/recovery endpoint), then Mark's API, gateway and web together, then CM. Pairwise testing is useful and does not require simultaneous deployment:

1. **Mark + AWB:** Register a staging quiz with different Mark/AWB IDs. Launch as its owner and as an authorized organization member. Verify an unrelated user and removed member cannot obtain a fresh author launch. Open the copied Mark editor link in incognito: expect sign-in guidance, then recovery to the correct AWB assignment after signing in. Verify a wrong provider/ID is unavailable.
2. **Mark + CM:** Create a quiz and open Edit repeatedly; each click obtains fresh signatures in its own tab. Edit a title without saving, open a learner preview, then return and save as author. Keep two different author quizzes open and repeat. Block pop-ups or fail credential refresh and verify an actionable error without losing the earlier editor. Exercise expired sessions and recovery using the original account; switching accounts must not expose/reopen or save the previous editor's draft. Complete a learner submission and check its ordinary grade callback.
3. **All three updated versions:** Generate in CM, publish to AWB, open it through AWB as a permitted colleague, and recover from the shared Mark URL. Retry publishing after a controlled link failure or lost response; verify one AWB record with the same Mark ID and owner, unchanged AWB edits, the required group link, and a completed CM export containing the correct AWB URL. Confirm direct author API calls for another quiz fail even when both quizzes have the same group and no author headers/referrer are supplied.

Final acceptance needs all three updated versions connected at once. Mark + CM alone cannot prove AWB publishing/recovery, and Mark + AWB alone cannot prove CM's publishing and completion behavior. Do not promote until these end-to-end checks pass. For rollback, return Mark web/gateway/API together; the AWB retry endpoint is backward compatible and can stay deployed.

## Local validation

- AWB: 39 registration/recovery request examples; recovery RuboCop passes.
- CM: 68 backend examples, 111 frontend tests, typecheck and changed-file lint pass.
- Mark: 68 gateway tests pass (19 existing skipped), 25 assignment/question guard tests, 26 web tests including recovery and request context; full repository lint and gateway typecheck pass.
- Mark web production build succeeds with `next build --webpack`. Default Turbopack rejects this worktree's external node_modules symlinks. Standalone web typecheck reports the same three VideoPresentationEditor BlobPart errors in the unchanged main checkout; the new author files have no remaining type errors.
- Cross-app staging tests have not yet run. Dependency graph AST extraction was refreshed locally; the repository graph command reports disabled, and the visualizer skips HTML for graphs above its node limit.


## Learner refresh follow-up

Author and learner sessions are now saved separately (up to four quizzes per role). Browser requests and learner server rendering explicitly select the role for the quiz; authorMode=true selects a deliberate author preview. Context never grants a role: the selected token and the current same-account launch must both be valid. Forward the selected learner token to the API for the original grade callback. Existing attempt-ownership checks remain in force.

This follow-up also rebuilds incomplete cached previews and supplies display order, time-limit state, introduction and instructions for preview grading. Persisted allotted minutes determine the time-limit flag; valid unsaved preview settings are retained.

Deploy the gateway and web together. No AWB/CM change or migration is required for this follow-up. An existing browser needs a fresh learner launch to populate its learner cookie; a lost learner token cannot be recovered from an author token. Start testing from CM Launch Quiz, not an old URL containing authorMode=true.

Staging acceptance: launch learner, answer without submitting, open author, refresh the original learner tab, confirm the same attempt/answers and no authorMode=true switch, then submit and verify grading/callback. Repeat in the reverse launch order. Separately use Check learner side from the editor and verify explicit author preview grading after refresh, including a timed quiz. Check logout/account switching/expiry fail closed and do not use another user's saved session.
