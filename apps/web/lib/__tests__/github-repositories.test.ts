import type { Octokit } from "@octokit/rest";
import { listGithubRepositories } from "../github-repositories";

const repository = (id: number, owner = "organization") => ({
  id,
  name: `repo-${id}`,
  full_name: `${owner}/repo-${id}`,
  private: false,
  owner: { login: owner },
});

it("uses the pagination client and retains repositories beyond the first 100 results", async () => {
  const repositories = [
    ...Array.from({ length: 200 }, (_, i) => repository(i + 1)),
    repository(201, "my-account"),
  ];
  const client = {
    repos: {
      listForAuthenticatedUser: jest
        .fn()
        .mockResolvedValue({ data: repositories.slice(0, 30) }),
    },
    paginate: jest.fn().mockResolvedValue(repositories),
  };
  const result = await listGithubRepositories(client as unknown as Octokit);
  expect(result).toHaveLength(201);
  expect(result.at(-1)?.full_name).toBe("my-account/repo-201");
  expect(client.paginate).toHaveBeenCalledWith(
    client.repos.listForAuthenticatedUser,
    {
      per_page: 100,
      visibility: "all",
      affiliation: "owner,collaborator,organization_member",
      sort: "full_name",
      direction: "asc",
    },
  );
  expect(client.repos.listForAuthenticatedUser).not.toHaveBeenCalled();
});

it("deduplicates IDs without collapsing equal names under different owners", async () => {
  const first = {
    ...repository(1, "organization"),
    name: "project",
    full_name: "organization/project",
  };
  const second = {
    ...repository(2, "me"),
    name: "project",
    full_name: "me/project",
  };
  const client = {
    repos: { listForAuthenticatedUser: jest.fn() },
    paginate: jest.fn().mockResolvedValue([first, second, first]),
  };
  expect(await listGithubRepositories(client as unknown as Octokit)).toEqual([
    first,
    second,
  ]);
});

it("propagates a pagination failure instead of returning a truncated list", async () => {
  const failure = new Error("later page failed");
  const client = {
    repos: { listForAuthenticatedUser: jest.fn() },
    paginate: jest.fn().mockRejectedValue(failure),
  };
  await expect(
    listGithubRepositories(client as unknown as Octokit),
  ).rejects.toBe(failure);
});
