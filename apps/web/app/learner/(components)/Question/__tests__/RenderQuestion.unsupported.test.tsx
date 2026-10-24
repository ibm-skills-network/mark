/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { QuestionStore } from "@/config/types";
import { UNSUPPORTED_QUESTION_NOTICE } from "@/lib/unsupported-questions";
import RenderQuestion from "../RenderQuestion";

jest.mock("@/hooks/use-ui-translation", () => ({
  useUiTranslation: () => ({ t: (source: string) => source }),
}));
jest.mock("@/stores/learner", () => ({
  useLearnerStore: (selector: (state: unknown) => unknown) =>
    selector({
      onModeChange: jest.fn(),
      onUrlChange: jest.fn(),
      removeFileUpload: jest.fn(),
      onFileChange: jest.fn(),
    }),
}));
jest.mock("../FileUploadSection", () => ({
  __esModule: true,
  default: () => <div>uploader</div>,
}));
jest.mock("../FileLinkUploadSection", () => ({
  __esModule: true,
  default: () => <div>file or link</div>,
}));
jest.mock("../MultipleChoiceQuestion", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../TextQuestion", () => ({ __esModule: true, default: () => null }));
jest.mock("../TrueFalseQuestion", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../UrlQuestion", () => ({ __esModule: true, default: () => null }));

const question = (type: string, responseType: string): QuestionStore =>
  ({ id: 4, type, responseType }) as unknown as QuestionStore;

describe("RenderQuestion for recording and presentation questions", () => {
  it.each([
    ["UPLOAD", "PRESENTATION"],
    ["UPLOAD", "LIVE_RECORDING"],
    ["UPLOAD", "VIDEO"],
    ["LINK_FILE", "AUDIO"],
  ])("shows the notice instead of the %s %s input", (type, responseType) => {
    render(
      <RenderQuestion
        questionType={type as QuestionStore["type"]}
        question={question(type, responseType)}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      UNSUPPORTED_QUESTION_NOTICE,
    );
    expect(screen.queryByText("uploader")).toBeNull();
    expect(screen.queryByText("file or link")).toBeNull();
  });

  it("still shows the uploader for a supported upload question", () => {
    render(
      <RenderQuestion
        questionType="UPLOAD"
        question={question("UPLOAD", "REPORT")}
      />,
    );

    expect(screen.getByText("uploader")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("sends a code question to the plain uploader", () => {
    render(
      <RenderQuestion
        questionType="CODE"
        question={question("CODE", "CODE")}
      />,
    );

    expect(screen.getByText("uploader")).toBeTruthy();
  });
});
