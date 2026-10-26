import { getGithubAppInstallationToken } from "./github-app-token";

/**
 * Server-side GitHub credential applied to api.github.com requests made
 * while fetching a learner's submitted URL for grading (default-branch
 * resolution, folder listings, repository-metadata fallback). This is a
 * server credential — never a learner's own OAuth token.
 *
 * GITHUB_GRADING_API_TOKEN wins when set. Otherwise the Mark GitHub App's
 * installation token is used (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY). With
 * neither, GitHub API calls fall back to the unauthenticated 60
 * requests/hour/IP limit, shared across every concurrent learner
 * submission from the same egress IP.
 */
export async function getGithubGradingApiToken(): Promise<string | undefined> {
  const trimmed = process.env.GITHUB_GRADING_API_TOKEN?.trim();
  if (trimmed) return trimmed;
  return getGithubAppInstallationToken();
}
