/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { QuestionStore } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import UrlQuestion from "../UrlQuestion";

const mockSetURLResponse = jest.fn();

jest.mock("@/stores/learner", () => ({
  useLearnerStore: jest.fn(),
}));

const BLOB_URL = "https://github.com/owner/repo/blob/main/router/general.js";

function makeQuestion(overrides: Partial<QuestionStore> = {}): QuestionStore {
  return {
    id: 42,
    learnerUrlResponse: "",
    responseType: "CODE",
    ...overrides,
  } as unknown as QuestionStore;
}

function renderQuestion(question: QuestionStore, onUrlChange = jest.fn()) {
  return {
    onUrlChange,
    ...render(<UrlQuestion question={question} onUrlChange={onUrlChange} />),
  };
}

describe("UrlQuestion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({
        activeAttemptId: 1,
        setURLResponse: mockSetURLResponse,
      }),
    );
  });

  it("shows no message for a link that will grade", () => {
    renderQuestion(makeQuestion({ learnerUrlResponse: BLOB_URL }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  it("accepts a pasted trailing space without flagging it", () => {
    renderQuestion(makeQuestion({ learnerUrlResponse: `${BLOB_URL} ` }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("accepts a schemeless link without flagging it", () => {
    renderQuestion(
      makeQuestion({ learnerUrlResponse: BLOB_URL.replace("https://", "") }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an always-visible message for a value that is not a link", () => {
    renderQuestion(makeQuestion({ learnerUrlResponse: "dgtj" }));

    const alert = screen.getByRole("alert");
    expect(alert).toBeVisible();
    expect(alert.textContent).toMatch(/web address/i);
    // The message must sit in the document flow, not in a hover-gated or
    // absolutely-positioned overlay that a touch device can never reveal.
    expect(alert.className).not.toMatch(/absolute|group-hover/);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("says nothing at all while the field is still empty", () => {
    renderQuestion(makeQuestion({ learnerUrlResponse: "" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns without blocking when a repository question gets another host", () => {
    renderQuestion(
      makeQuestion({
        responseType: "REPO",
        learnerUrlResponse: "https://gitlab.com/owner/repo",
      }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/github/i);
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  it("adds the missing scheme when the learner leaves the field", () => {
    const { onUrlChange } = renderQuestion(
      makeQuestion({ learnerUrlResponse: BLOB_URL.replace("https://", "") }),
    );

    fireEvent.blur(screen.getByRole("textbox"));

    expect(mockSetURLResponse).toHaveBeenCalledWith(BLOB_URL, 42);
    expect(onUrlChange).toHaveBeenCalledWith(BLOB_URL, 42);
  });

  it("leaves an already-normalized value untouched on blur", () => {
    renderQuestion(makeQuestion({ learnerUrlResponse: BLOB_URL }));

    fireEvent.blur(screen.getByRole("textbox"));

    expect(mockSetURLResponse).not.toHaveBeenCalled();
  });
});
