/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type {
  CompletedAttemptQuestion,
  ExtendedFileContent,
} from "@/config/types";

import Question from "../Question";

const mockFetchFileContentSafe = jest.fn();
const previewProps: Array<{
  loading?: boolean;
  content?: ExtendedFileContent | null;
}> = [];

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { questionControls: {} } }),
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
    onNext?: () => void;
    onPrevious?: () => void;
    onClose?: () => void;
  }) => {
    previewProps.push({ loading: props.loading, content: props.content });
    return (
      <>
        <button onClick={props.onNext}>Next file</button>
        <button onClick={props.onPrevious}>Previous file</button>
        <button onClick={props.onClose}>Close preview</button>
      </>
    );
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
const uploadQuestion: CompletedAttemptQuestion = {
  id: 5861,
  question: "Upload your notebook",
  totalPoints: 10,
  type: "UPLOAD",
  responseType: "OTHER",
  choices: null,
  scoring: null,
  response: {
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
};

const renderUpload = (question: CompletedAttemptQuestion) =>
  render(
    <Question
      question={question}
      number={1}
      language="en"
      showSubmissionFeedback
      showQuestionScore
      correctAnswerVisibility="NEVER"
    />,
  );

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

    renderUpload(uploadQuestion);

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
  it("ignores an older request after navigating away and back", async () => {
    const resolvers: Array<(value: ExtendedFileContent) => void> = [];
    mockFetchFileContentSafe.mockImplementation(
      () =>
        new Promise<ExtendedFileContent>((resolve) => resolvers.push(resolve)),
    );
    const question: CompletedAttemptQuestion = {
      ...uploadQuestion,
      response: {
        ...uploadQuestion.response,
        learnerResponse: JSON.stringify(
          ["first", "second"].map((name) => ({
            filename: `${name}.ipynb`,
            content: "InCos",
            key: `learner/7/${name}.ipynb`,
            bucket: "learner-bucket",
          })),
        ),
      },
    };
    renderUpload(question);
    fireEvent.click(screen.getAllByText("View Content")[0]);
    fireEvent.click(screen.getByText("Next file"));
    fireEvent.click(screen.getByText("Previous file"));

    await act(async () => {
      resolvers[0]({ content: "stale first", size: 11 });
    });
    expect(previewProps.at(-1)).toEqual({ loading: true, content: null });
    await act(async () => {
      resolvers[2]({ content: "current first", size: 13 });
    });
    await act(async () => {
      resolvers[1]({ content: "stale second", size: 12 });
    });
    expect(previewProps.at(-1)).toMatchObject({
      loading: false,
      content: { content: "current first", size: 13 },
    });
  });
  it("ignores a pending request after closing and reopening the preview", async () => {
    const resolvers: Array<(value: ExtendedFileContent) => void> = [];
    mockFetchFileContentSafe.mockImplementation(
      () =>
        new Promise<ExtendedFileContent>((resolve) => resolvers.push(resolve)),
    );
    renderUpload(uploadQuestion);
    fireEvent.click(screen.getByText("View Content"));
    fireEvent.click(screen.getByText("Close preview"));
    fireEvent.click(screen.getByText("View Content"));
    await act(async () => {
      resolvers[0]({ content: "old content", size: 11 });
    });
    expect(previewProps.at(-1)).toEqual({ loading: true, content: null });
    await act(async () => {
      resolvers[1]({ content: "new content", size: 12 });
    });
    expect(previewProps.at(-1)).toMatchObject({
      loading: false,
      content: { content: "new content", size: 12 },
    });
  });
});
