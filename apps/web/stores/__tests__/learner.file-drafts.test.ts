import type { QuestionStore } from "@/config/types";
import { referenceOnlyStoredDrafts, useLearnerStore } from "../learner";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
}));

const upload = {
  filename: "report.pdf",
  key: "42/learner@example.com/7/report.pdf",
  bucket: "learner-bucket",
  fileType: "application/pdf",
};

const repositoryEntry = {
  filename: "main.py",
  githubUrl: "https://github.com/o/r/blob/main/main.py",
  owner: "o",
  repo: "r",
  path: "main.py",
  content: "print('hi')\n".repeat(200),
};

const staleDraft = () => ({
  id: 7,
  status: "edited",
  learnerFileResponse: [
    repositoryEntry,
    { ...upload, content: "full file text ".repeat(50) },
  ],
});

const storageName = () => useLearnerStore.persist.getOptions().name ?? "";

const writeStoredState = (version: number) => {
  localStorage.setItem(
    storageName(),
    JSON.stringify({
      state: { questions: [staleDraft()], activeAttemptId: 500 },
      version,
    }),
  );
};

describe("learner file drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    useLearnerStore.setState({ questions: [], activeAttemptId: null });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reduces drafts stored by an older client to upload references only", () => {
    expect(
      referenceOnlyStoredDrafts({
        questions: [staleDraft()],
        activeAttemptId: 500,
      }),
    ).toEqual({
      activeAttemptId: 500,
      questions: [
        {
          id: 7,
          status: "edited",
          learnerFileResponse: [{ ...upload, content: "InCos" }],
        },
      ],
    });
  });

  it("leaves a stored state without questions alone", () => {
    expect(referenceOnlyStoredDrafts(null)).toBeNull();
    expect(referenceOnlyStoredDrafts({ activeAttemptId: 1 })).toEqual({
      activeAttemptId: 1,
    });
  });

  it.each([0, 1])(
    "cleans stale file entries when version %i drafts are restored",
    async (version) => {
      writeStoredState(version);

      await useLearnerStore.persist.rehydrate();

      const [question] = useLearnerStore.getState().questions;
      expect(question.learnerFileResponse).toEqual([
        { ...upload, content: "InCos" },
      ]);
      expect(useLearnerStore.getState().activeAttemptId).toBe(500);
    },
  );

  it("cleans file entries already in the store", () => {
    useLearnerStore.setState({
      questions: [staleDraft() as unknown as QuestionStore],
    });

    useLearnerStore.getState().dropUnsubmittableFiles();

    expect(useLearnerStore.getState().questions[0].learnerFileResponse).toEqual(
      [{ ...upload, content: "InCos" }],
    );
  });

  it("keeps question identity when every file is already a reference", () => {
    const clean = {
      id: 7,
      learnerFileResponse: [{ ...upload, content: "InCos" }],
    } as unknown as QuestionStore;
    useLearnerStore.setState({ questions: [clean] });

    useLearnerStore.getState().dropUnsubmittableFiles();

    expect(useLearnerStore.getState().questions[0]).toBe(clean);
  });

  it("removes an entry without a stored object by name, sparing uploads of the same name", () => {
    const sameName = { ...upload, filename: "main.py" };
    useLearnerStore.setState({
      questions: [
        {
          id: 7,
          learnerFileResponse: [repositoryEntry, sameName],
        } as unknown as QuestionStore,
      ],
    });

    useLearnerStore.getState().removeFileUpload(repositoryEntry, 7);

    expect(useLearnerStore.getState().questions[0].learnerFileResponse).toEqual(
      [sameName],
    );
  });
});
