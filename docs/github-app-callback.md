# GitHub App authorization callbacks

Register these **Callback URLs** on the GitHub App (not its installation Setup URL):

- Production: `https://mark.skills.network/api/github/callback`
- Staging: `https://mark.staging.skills.network/api/github/callback`

One callback per environment serves every assignment, language, and results page.

## Deployment

Deploy the API and web changes together. If a rolling deployment is necessary,
update web first: the existing assignment callback remains supported during the
transition, and the new fixed callback will only be issued by the updated API.
Jobs and ingress configuration do not need changes for this flow.

In `apps-faculty-deploy`, the learner GitHub connection uses
`api.secretEnv.GITHUB_CLIENT_ID` and `api.secretEnv.GITHUB_CLIENT_SECRET` in
`config/mark/secrets.yaml`, with optional environment-specific overrides. Use
`helm secrets edit` to edit those encrypted files. Each environment's API
`WEB_APP_URL` must name that environment's web origin. The same GitHub App can
serve both environments. Its App ID/private key settings belong to the separate
issue-reporting integration, not this user authorization flow.

## Flow and security

1. The API validates the initiating learner-page URL against its configured
   web origins. It removes old OAuth parameters and binds the return URL to
   expiring, HMAC-signed state for the authenticated user.
2. GitHub receives the fixed `/api/github/callback` URL in `redirect_uri`.
   Assignment paths and language parameters do not change the callback URL.
3. The web callback forwards the session cookie, code/denial, and state to the
   authenticated API. The API verifies the state before exchanging a code or
   returning a destination. The token exchange includes the same fixed callback.
4. The API stores the token and returns a relative learner-page path. The web
   callback redirects there with a non-sensitive `github_auth` outcome. Codes,
   state, and access tokens are not forwarded in that URL. Callback responses
   disable caching and referrer propagation.
5. The file picker consumes the outcome and loads the saved token. Cancellation
   and failures do not automatically restart authorization.

An invalid or expired session/state cannot supply a trusted return destination;
those callbacks show a generic error asking the learner to reopen the assignment.
The previous code-exchange endpoint remains available for handoffs already in
flight during rollout. GitHub App installation-token authentication and automatic
user-token refresh are separate work.

## Staging verification

Use a fresh connection so an old saved token cannot hide a callback failure:

- Connect from two different assignments, including a non-English page.
- Verify GitHub's `redirect_uri` is exactly the staging callback above.
- Finish authorization and confirm the original assignment, language, and author
  preview flag (when applicable) are preserved; verify repository/file access.
- Repeat from a results page containing a GitHub submission.
- Cancel authorization and confirm there is no automatic sign-in loop.
- Expire the Mark session before returning and confirm the callback fails closed.

Registering callback URLs alone does not validate repository permissions. Test
with a repository accessible to both the user and the GitHub App installation.
