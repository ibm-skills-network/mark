import type { Octokit } from "@octokit/rest";
import type { RepoType } from "@/config/types";

/** /user/repos already includes owned, collaborator, and organization repositories. */
export async function listGithubRepositories(
  octokit: Octokit,
): Promise<RepoType[]> {
  const repositories = await octokit.paginate(
    octokit.repos.listForAuthenticatedUser,
    {
      per_page: 100,
      visibility: "all",
      affiliation: "owner,collaborator,organization_member",
      sort: "full_name",
      direction: "asc",
    },
  );
  // Repositories can move between pages while the list is being fetched.
  return [
    ...new Map(
      repositories.map((repository) => [repository.id, repository]),
    ).values(),
  ];
}
