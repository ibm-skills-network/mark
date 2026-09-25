/**
 * @jest-environment jsdom
 */

import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { QuestionStore } from "@/config/types";
import { resetGithubHandoffForTesting } from "@/lib/github-oauth";

import Question from "../Question";

const mockAuthorizeGithubBackend = jest.fn();
const mockGetStoredGithubToken = jest.fn();
const mockOctokitRequest = jest.fn();
const mockOpen = jest.fn();

jest.mock("@/lib/talkToBackend", () => ({
  AuthorizeGithubBackend: (...args: unknown[]) =>
    mockAuthorizeGithubBackend(...args),
  getStoredGithubToken: () => mockGetStoredGithubToken(),
}));

jest.mock("@octokit/rest", () => ({
  Octokit: class {
    request = (...args: unknown[]) => mockOctokitRequest(...args);
  },
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { questionControls: {} } }),
  useLearnerOverviewStore: (selector: (state: unknown) => unknown) =>
    selector({ assignmentId: 3601 }),
}));

// The bootstrap under test is the only thing these renders exercise; the
// presentation pieces pull in Quill, PDF.js and the file explorer, none of
// which this file is about.
jest.mock("@/components/rich-text/RichTextViewer", () => ({
  __esModule: true,
  default: ({ content }: { content?: string }) => <div>{content}</div>,
}));
jest.mock("@/components/CollapsibleFeedback", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/PdfFeedbackViewer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/FileExplorer/FilePreview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../PdfAnnotationModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../(components)/Question/ShowHideRubric", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/lib/shared", () => ({
  fetchFileContentSafe: jest.fn(),
  downloadFile: jest.fn(),
  getFileExtension: () => "txt",
}));

const fetchMock = jest.fn();

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

const setUrl = (url: string) => window.history.replaceState({}, "", url);

const countCallbackPosts = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth-callback"))
    .length;

// A graded upload answer whose file came from a repository — the only shape
// that starts the GitHub bootstrap on this page.
const githubQuestion = (id: number): QuestionStore =>
  ({
    id,
    question: `Question ${id}`,
    totalPoints: 10,
    type: "UPLOAD",
    questionResponses: [
      {
        id,
        points: 10,
        feedback: [{ feedback: "Looks good" }],
        learnerResponse: JSON.stringify([
          {
            filename: `answer-${id}.py`,
            githubUrl: `https://github.com/learner/repo/blob/main/answer-${id}.py`,
          },
        ]),
      },
    ],
    // A fixture, not a real store entry: only the fields the bootstrap reads
    // are populated.
  }) as unknown as QuestionStore;

const renderQuestions = async (count: number) => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <>
        {Array.from({ length: count }, (_, index) => (
          <Question
            key={index}
            question={githubQuestion(9900 + index)}
            number={index + 1}
            language="en"
            showSubmissionFeedback
          />
        ))}
      </>,
    );
  });
  if (!view) throw new Error("render did not produce a view");
  return view;
};

describe("results page — GitHub bootstrap across sibling questions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetStoredGithubToken.mockResolvedValue(null);
    mockAuthorizeGithubBackend.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=x&state=st-1",
    });
    window.open = mockOpen as unknown as typeof window.open;
    resetGithubHandoffForTesting();
    setUrl("/learner/3601/successPage/551");
  });

  // A submission with two GitHub answers renders two of these. Whichever one
  // lost the race for the code fell through to the redirect and navigated the
  // whole page to github.com, cancelling the exchange the winner was awaiting.
  it("does not navigate to GitHub while a sibling is exchanging the code", async () => {
    setUrl("/learner/3601/successPage/551?code=code-1&state=st-1");
    let settle: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );

    await renderQuestions(3);

    expect(countCallbackPosts()).toBe(1);
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();

    mockOctokitRequest.mockResolvedValue({ data: {} });
    await act(async () => {
      settle(jsonResponse(200, { token: "gho_ok" }));
    });

    await waitFor(() => expect(countCallbackPosts()).toBe(1));
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("does not navigate to GitHub after a sibling's exchange has failed", async () => {
    setUrl("/learner/3601/successPage/551?code=code-1&state=st-1");
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: "github_authorization_expired" }),
    );

    await renderQuestions(2);

    await waitFor(() => expect(countCallbackPosts()).toBe(1));
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("does not navigate to GitHub after the learner declined on the consent screen", async () => {
    setUrl("/learner/3601/successPage/551?error=access_denied&state=st-1");

    await renderQuestions(2);

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  // The effect depended on a URLSearchParams rebuilt on every render, so it
  // re-fired continuously — which is what turned one stray redirect into a loop.
  it("starts the handoff once, not once per render", async () => {
    const view = await renderQuestions(1);

    await waitFor(() =>
      expect(mockAuthorizeGithubBackend).toHaveBeenCalledTimes(1),
    );

    // Same tree, new props object each time — what a parent re-render does.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        view.rerender(
          <>
            <Question
              key={0}
              question={githubQuestion(9900)}
              number={1}
              language="en"
              showSubmissionFeedback
            />
          </>,
        );
      });
    }

    expect(mockAuthorizeGithubBackend).toHaveBeenCalledTimes(1);
  });

  it("still connects when this page load has nothing to consume", async () => {
    await renderQuestions(1);

    await waitFor(() =>
      expect(mockAuthorizeGithubBackend).toHaveBeenCalledTimes(1),
    );
    expect(mockOpen).toHaveBeenCalledWith(expect.any(String), "_self");
  });

  it("uses a token the backend already holds instead of redirecting", async () => {
    mockGetStoredGithubToken.mockResolvedValue("gho_stored");
    mockOctokitRequest.mockResolvedValue({ data: {} });

    await renderQuestions(2);

    await waitFor(() => expect(mockGetStoredGithubToken).toHaveBeenCalled());
    expect(mockAuthorizeGithubBackend).not.toHaveBeenCalled();
  });
});
