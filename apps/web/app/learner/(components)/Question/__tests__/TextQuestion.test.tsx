/**
 * @jest-environment jsdom
 */

import { render } from "@testing-library/react";
import type { QuestionStore } from "@/config/types";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import TextQuestion from "../TextQuestion";

const mockMarkdownEditor = jest.fn();
const mockSetTextResponse = jest.fn();

jest.mock("@components/MarkDownEditor", () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockMarkdownEditor(props);
    return null;
  },
}));

jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: jest.fn(),
  useLearnerStore: jest.fn(),
}));

const question = {
  id: 42,
  learnerTextResponse: "<p>Existing answer</p>",
  maxWords: 100,
  maxCharacters: 500,
} as unknown as QuestionStore;

describe("TextQuestion", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({
        activeAttemptId: 1,
        setTextResponse: mockSetTextResponse,
      }),
    );

    (useAssignmentDetails as unknown as jest.Mock).mockImplementation(
      (selector) =>
        selector({
          assignmentDetails: {
            questionControls: {
              disableCopy: true,
            },
          },
        }),
    );
  });

  it("uses the simplified learner toolbar for text answers", () => {
    render(<TextQuestion question={question} />);

    expect(mockMarkdownEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCopy: false,
        maxCharacters: 500,
        maxWords: 100,
        placeholder: "Type your answer here",
        toolbarMode: "learner",
        value: "<p>Existing answer</p>",
      }),
    );

    const editorProps = mockMarkdownEditor.mock.calls[0][0] as {
      setValue: (value: string) => void;
    };
    editorProps.setValue("<p>Updated answer</p>");

    expect(mockSetTextResponse).toHaveBeenCalledWith(
      "<p>Updated answer</p>",
      42,
    );
  });
});
