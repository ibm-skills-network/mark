import type { QuestionStore } from "@/config/types";
import { useLearnerStore, type learnerFileResponse } from "../learner";

jest.mock("@/lib/talkToBackend", () => ({ getUser: jest.fn() }));

const githubFile: learnerFileResponse = {
  filename: "check-packaging.mjs",
  content: "console.log('unrelated submission');",
  githubUrl:
    "https://raw.githubusercontent.com/example/project/main/check-packaging.mjs",
};
const storedFile: learnerFileResponse = {
  filename: "answer.py",
  content: "print('answer')",
  bucket: "test-bucket",
  key: "uploads/answer.py",
  fileType: "text/x-python",
  mimeType: "text/x-python",
};

describe("learner file source metadata", () => {
  beforeEach(() => {
    localStorage.clear();
    useLearnerStore.setState({
      questions: [
        { id: 7, type: "LINK_FILE", responseType: "CODE" } as QuestionStore,
      ],
      activeAttemptId: null,
    });
  });

  it.each([githubFile, storedFile])(
    "preserves source metadata when selecting $filename in file/link mode",
    (file) => {
      useLearnerStore.getState().onModeChange("file", [file], 7);
      const files = useLearnerStore.getState().questions[0].learnerFileResponse;
      expect(files).toEqual([file]);
      // Exercise the persisted payload that is recovered after a refresh.
      const key = Object.keys(localStorage).find((key) =>
        /^learner-(?!overview)/.test(key),
      );
      expect(key).toBeDefined();
      const saved = JSON.parse(localStorage.getItem(key)!);
      expect(saved.state.questions[0].learnerFileResponse).toEqual([file]);
    },
  );

  it("preserves metadata for direct file selection and mixed sources", () => {
    useLearnerStore.getState().onFileChange([githubFile, storedFile], 7);
    expect(useLearnerStore.getState().questions[0].learnerFileResponse).toEqual(
      [githubFile, storedFile],
    );
  });

  it("stores a parsed notebook's content as its JSON text", () => {
    const notebook = { cells: [{ cell_type: "code", source: ["x = 1"] }] };
    const parsed = {
      filename: "lab.ipynb",
      githubUrl: "https://github.com/learner/repo/blob/main/lab.ipynb",
      content: notebook,
    } as unknown as learnerFileResponse;

    useLearnerStore.getState().onFileChange([parsed], 7);
    let [file] = useLearnerStore.getState().questions[0].learnerFileResponse;
    expect(typeof file.content).toBe("string");
    expect(JSON.parse(file.content)).toEqual(notebook);

    useLearnerStore.getState().onFileChange([], 7);
    useLearnerStore.getState().addFileUpload(parsed, 7);
    [file] = useLearnerStore.getState().questions[0].learnerFileResponse!;
    expect(typeof file.content).toBe("string");
  });
});
