/**
 * @jest-environment jsdom
 */

import { createElement, forwardRef, type ReactNode, type Ref } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetGithubHandoffForTesting } from "@/lib/github-oauth";

import GithubUploadModal from "../GithubUploadModal";

const mockAuthorizeGithubBackend = jest.fn();
const mockGetStoredGithubToken = jest.fn();
const mockGetUser = jest.fn();
const mockOctokitRequest = jest.fn();

jest.mock("@/lib/talkToBackend", () => ({
  AuthorizeGithubBackend: (...args: unknown[]) =>
    mockAuthorizeGithubBackend(...args),
  getStoredGithubToken: () => mockGetStoredGithubToken(),
  getUser: () => mockGetUser(),
}));

jest.mock("@octokit/rest", () => ({
  Octokit: class {
    request = (...args: unknown[]) => mockOctokitRequest(...args);

    repos = {
      listForAuthenticatedUser: jest.fn().mockResolvedValue({ data: [] }),
      getContent: jest.fn().mockResolvedValue({ data: [] }),
      listForOrg: jest.fn().mockResolvedValue({ data: [] }),
    };

    orgs = {
      listForAuthenticatedUser: jest.fn().mockResolvedValue({ data: [] }),
    };
  },
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

jest.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef(
          (
            { children, ...props }: { children?: ReactNode },
            ref: Ref<HTMLElement>,
          ) => {
            const sanitized: Record<string, unknown> = { ...props };
            for (const key of [
              "whileHover",
              "whileTap",
              "initial",
              "animate",
              "exit",
              "transition",
            ]) {
              delete sanitized[key];
            }
            return createElement(tag, { ...sanitized, ref }, children);
          },
        ),
    },
  );

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion,
  };
});

const fetchMock = jest.fn();

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

const onClose = jest.fn();

// The suite's MessageChannel stub keeps React's scheduler from flushing work
// queued outside act(), so every render that kicks off the OAuth effect is
// awaited inside act — the repo's convention for async effects.
const renderModal = async () => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <GithubUploadModal
        onClose={onClose}
        assignmentId={3601}
        questionId={9917}
        owner={null}
        setOwner={jest.fn()}
        repos={[]}
        setRepos={jest.fn()}
        selectedFiles={[]}
        setSelectedFiles={jest.fn()}
        repoContents={[]}
        setRepoContents={jest.fn()}
        currentPath={[]}
        setCurrentPath={jest.fn()}
        addToPath={jest.fn()}
        selectedRepo={null}
        setSelectedRepo={jest.fn()}
        onFileChange={jest.fn()}
      />,
    );
  });
  if (!view) throw new Error("render did not produce a view");
  return view;
};

const setUrl = (url: string) => window.history.replaceState({}, "", url);

const countCallbackPosts = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth-callback"))
    .length;

describe("GithubUploadModal — returning from GitHub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUser.mockResolvedValue({ role: "learner" });
    mockGetStoredGithubToken.mockResolvedValue(null);
    mockAuthorizeGithubBackend.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=x&state=st-1",
    });
    setUrl("/learner/3601/questions");
  });

  it("loads the token saved by the fixed callback without exchanging again", async () => {
    resetGithubHandoffForTesting();
    setUrl("/learner/3601/questions?lang=fr&github_auth=success");
    mockGetStoredGithubToken.mockResolvedValue("ghu_saved");
    mockOctokitRequest.mockResolvedValue({ data: { login: "learner" } });
    await renderModal();
    expect(mockGetStoredGithubToken).toHaveBeenCalled();
    expect(countCallbackPosts()).toBe(0);
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?lang=fr");
  });

  it("shows a fixed-callback denial without starting another handoff", async () => {
    resetGithubHandoffForTesting();
    setUrl("/learner/3601/questions?github_auth=access_denied");
    await renderModal();
    expect(countCallbackPosts()).toBe(0);
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/GitHub did not give Mark access/i),
    ).toBeInTheDocument();
  });

  it("strips the authorization code from the URL even when the exchange fails", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(
      jsonResponse(503, { code: "github_configuration_error" }),
    );

    await renderModal();

    await waitFor(() => expect(countCallbackPosts()).toBe(1));
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  // Production posted the same single-use code 2-6 times per authorization.
  it("does not replay the same code when the modal remounts", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(
      jsonResponse(503, { code: "github_configuration_error" }),
    );

    const first = await renderModal();
    await waitFor(() => expect(countCallbackPosts()).toBe(1));
    first.unmount();

    // A remount with the code put back in the URL — what a reload or a move
    // between two upload questions used to do.
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    await renderModal();

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(countCallbackPosts()).toBe(1);
  });

  it("sends the state parameter back with the code", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(jsonResponse(200, { token: "gho_ok" }));
    mockOctokitRequest.mockResolvedValue({ data: {} });

    await renderModal();

    await waitFor(() => expect(countCallbackPosts()).toBe(1));
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("oauth-callback"),
    ) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({
      code: "code-1",
      state: "st-1",
    });
  });
});

describe("GithubUploadModal — failure copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUser.mockResolvedValue({ role: "learner" });
    mockGetStoredGithubToken.mockResolvedValue(null);
    mockAuthorizeGithubBackend.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=x&state=st-1",
    });
    setUrl("/learner/3601/questions");
  });

  it("does not claim the learner's token expired when the integration is misconfigured", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(
      jsonResponse(503, { code: "github_configuration_error" }),
    );

    await renderModal();

    await waitFor(() =>
      expect(
        screen.queryByText(/token is invalid or expired/i),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/problem on our side/i)).toBeInTheDocument();
  });

  it("tells the learner to refresh when their Mark session is what expired", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));

    await renderModal();

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it("offers another attempt for a code that was already used", async () => {
    setUrl("/learner/3601/questions?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: "github_authorization_expired" }),
    );

    await renderModal();

    expect(
      await screen.findByRole("button", { name: /connect to github/i }),
    ).toBeInTheDocument();
  });
});

// Cancelling on GitHub's consent screen comes back as `?error=access_denied`
// with no code. The parameters used to survive in the URL, nothing counted the
// refusal, and the modal reopened from its persisted flag and sent the learner
// straight back to the screen they had just declined.
describe("GithubUploadModal — declined on GitHub's consent screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUser.mockResolvedValue({ role: "learner" });
    mockGetStoredGithubToken.mockResolvedValue(null);
    mockAuthorizeGithubBackend.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=x&state=st-1",
    });
    resetGithubHandoffForTesting();
  });

  const decline = () =>
    setUrl(
      "/learner/3601/questions?error=access_denied" +
        "&error_description=The+user+has+denied+your+application+access" +
        "&state=st-1",
    );

  it("does not send the learner straight back to the screen they declined", async () => {
    decline();

    await renderModal();

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(countCallbackPosts()).toBe(0);
  });

  it("says what happened and leaves the direct-upload way out", async () => {
    decline();

    await renderModal();

    expect(
      await screen.findByText(/approve access to continue/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload a file instead/i }),
    ).toBeInTheDocument();
  });

  it("counts a refusal against the connection budget", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      decline();
      const view = await renderModal();
      await waitFor(() => expect(window.location.search).toBe(""));
      view.unmount();
      resetGithubHandoffForTesting();
    }

    setUrl("/learner/3601/questions");
    await renderModal();

    expect(
      await screen.findByText(/upload your file directly/i),
    ).toBeInTheDocument();
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
  });
});

describe("GithubUploadModal — capped re-authorize loop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetUser.mockResolvedValue({ role: "learner" });
    mockGetStoredGithubToken.mockResolvedValue(null);
    mockAuthorizeGithubBackend.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=x&state=st-1",
    });
  });

  const failOnce = async (code: string) => {
    setUrl(`/learner/3601/questions?code=${code}&state=st-1`);
    fetchMock.mockResolvedValue(
      jsonResponse(503, { code: "github_configuration_error" }),
    );
    const view = await renderModal();
    await waitFor(() => expect(window.location.search).toBe(""));
    view.unmount();
  };

  it("stops sending the learner back to GitHub and shows the direct-upload way out", async () => {
    await failOnce("code-1");
    await failOnce("code-2");
    await failOnce("code-3");

    setUrl("/learner/3601/questions");
    await renderModal();

    expect(
      await screen.findByText(/upload your file directly/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect to github/i }),
    ).not.toBeInTheDocument();
    // The dead-end loop is what learners reported: no further redirects.
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
  });

  it("closes the dialog so the file uploader underneath is reachable", async () => {
    await failOnce("code-1");
    await failOnce("code-2");
    await failOnce("code-3");

    setUrl("/learner/3601/questions");
    await renderModal();

    const closeButton = await screen.findByRole("button", {
      name: /upload a file instead/i,
    });
    await userEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });
});
