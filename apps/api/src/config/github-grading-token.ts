/**
 * Optional server-side GitHub token applied to api.github.com requests made
 * while fetching a learner's submitted URL for grading (default-branch
 * resolution, repository-metadata fallback). This is a server credential —
 * never a learner's own OAuth token. Contrast with
 * src/api/github/github.service.ts, which manages a per-user GitHub token
 * for a completely different feature (linking a learner's own GitHub
 * account); that token must never be reused here.
 *
 * When unset, GitHub API calls fall back to the unauthenticated 60
 * requests/hour/IP limit, shared across every concurrent learner
 * submission from the same egress IP.
 */
export function getGithubGradingApiToken(): string | undefined {
  const raw = process.env.GITHUB_GRADING_API_TOKEN;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}
