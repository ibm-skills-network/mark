/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ExtendedFileContent, QuestionStore } from "@/config/types";

import Question from "../Question";

const mockFetchFileContentSafe = jest.fn();
const previewProps: Array<{
  loading?: boolean;
  content?: ExtendedFileContent | null;
}> = [];

jest.mock("@/lib/talkToBackend", () => ({
  AuthorizeGithubBackend: jest.fn(),
  getStoredGithubToken: () => null,
}));
jest.mock("@octokit/rest", () => ({ Octokit: class {} }));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { questionControls: {} } }),
  useLearnerOverviewStore: (selector: (state: unknown) => unknown) =>
    selector({ assignmentId: 2115 }),
}));
jest.mock("@/components/MarkdownViewer", () => ({
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
  default: (props: {
    loading?: boolean;
    content?: ExtendedFileContent | null;
  }) => {
    previewProps.push({ loading: props.loading, content: props.content });
    return null;
  },
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
  fetchFileContentSafe: (...args: unknown[]) =>
    mockFetchFileContentSafe(...args),
  downloadFile: jest.fn(),
  getFileExtension: (name: string) => name.split(".").pop() ?? "",
}));

// A graded upload whose notebook lives in storage, as on assignment 2115.
const uploadQuestion = {
  id: 5861,
  question: "Upload your notebook",
  totalPoints: 10,
  type: "UPLOAD",
  questionResponses: [
    {
      id: 1,
      points: 10,
      feedback: [{ feedback: "Graded" }],
      learnerResponse: JSON.stringify([
        {
          filename: "analysis.ipynb",
          content: "InCos",
          key: "learner/7/analysis.ipynb",
          bucket: "learner-bucket",
          mimeType: "application/x-ipynb+json",
        },
      ]),
    },
  ],
} as unknown as QuestionStore;

describe("results page — previewing a stored upload", () => {
  beforeEach(() => {
    previewProps.length = 0;
    mockFetchFileContentSafe.mockReset();
  });

  it("marks the preview as loading until the content and its size arrive", async () => {
    let resolveFetch!: (value: ExtendedFileContent) => void;
    mockFetchFileContentSafe.mockReturnValueOnce(
      new Promise<ExtendedFileContent>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <Question
        question={uploadQuestion}
        number={1}
        language="en"
        showSubmissionFeedback
      />,
    );

    fireEvent.click(screen.getByText("View Content"));

    expect(previewProps.at(-1)).toEqual({ loading: true, content: null });

    await act(async () => {
      resolveFetch({
        content: '{"cells": []}',
        filename: "analysis.ipynb",
        questionId: "",
        size: 1363149,
      });
    });

    expect(previewProps.at(-1)?.loading).toBe(false);
    expect(previewProps.at(-1)?.content).toMatchObject({
      content: '{"cells": []}',
      size: 1363149,
    });
  });
});
