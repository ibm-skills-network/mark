import type { QuestionStore } from "@/config/types";
import {
  buildSubmitWarning,
  getSubmitButtonStatus,
  SUBMIT_WARNING_SOURCE_STRINGS,
} from "@/lib/utils";

function question(
  id: number,
  type: string,
  answer: Partial<QuestionStore> = {},
): QuestionStore {
  return {
    id,
    type,
    status: "unedited",
    learnerTextResponse: "",
    learnerFileResponse: [],
    learnerChoices: [],
    ...answer,
  } as unknown as QuestionStore;
}

const ANSWERED_TEXT = { learnerTextResponse: "<p>My answer</p>" };
const UPLOADED = {
  learnerFileResponse: [
    {
      filename: "answer.pdf",
      content: "InCos",
      key: "k",
      bucket: "b",
    },
  ],
} as Partial<QuestionStore>;

describe("buildSubmitWarning", () => {
  it("names the upload question that has no file", () => {
    const warning = buildSubmitWarning(
      [question(11, "TEXT", ANSWERED_TEXT), question(12, "UPLOAD")],
      {},
    );

    expect(warning).toEqual({
      message:
        "Your file for Question {question} hasn't been uploaded. Submit anyway?",
      params: { question: 2 },
    });
  });

  it("counts questions by display order, not id", () => {
    const warning = buildSubmitWarning(
      [
        question(90, "UPLOAD"),
        question(10, "TEXT", ANSWERED_TEXT),
        question(50, "TEXT", ANSWERED_TEXT),
      ],
      {},
    );

    expect(warning?.params).toEqual({ question: 1 });
  });

  it("lists every upload question without a file", () => {
    const warning = buildSubmitWarning(
      [
        question(1, "UPLOAD"),
        question(2, "TEXT", ANSWERED_TEXT),
        question(3, "CODE"),
      ],
      {},
    );

    expect(warning).toEqual({
      message:
        "Files for Questions {questions} haven't been uploaded. Submit anyway?",
      params: { questions: "1, 3" },
    });
  });

  it("says a failed upload sent nothing", () => {
    const warning = buildSubmitWarning(
      [question(1, "TEXT", ANSWERED_TEXT), question(2, "UPLOAD")],
      { uploadStatusByQuestion: { 2: "failed" } },
    );

    expect(warning).toEqual({
      message:
        "The file upload for Question {question} failed, so nothing will be submitted for it. Submit anyway?",
      params: { question: 2 },
    });
  });

  it("warns about a failed upload even on an optional question", () => {
    const warning = buildSubmitWarning(
      [question(1, "TEXT", ANSWERED_TEXT), question(2, "UPLOAD")],
      { optionalQuestionIds: [2], uploadStatusByQuestion: { 2: "failed" } },
    );

    expect(warning?.params).toEqual({ question: 2 });
  });

  it("stays quiet about an optional upload question left empty on purpose", () => {
    const warning = buildSubmitWarning(
      [question(1, "TEXT", ANSWERED_TEXT), question(2, "UPLOAD")],
      { optionalQuestionIds: [2] },
    );

    expect(warning).toBeNull();
  });

  it("ignores a failed attempt once a file did upload", () => {
    const warning = buildSubmitWarning(
      [question(1, "TEXT", ANSWERED_TEXT), question(2, "UPLOAD", UPLOADED)],
      { uploadStatusByQuestion: { 2: "failed" } },
    );

    expect(warning).toBeNull();
  });

  it("keeps the generic warning for other unanswered questions", () => {
    const warning = buildSubmitWarning(
      [question(1, "UPLOAD", UPLOADED), question(2, "TEXT")],
      {},
    );

    expect(warning).toEqual({
      message:
        "You have unanswered questions. Are you sure you want to submit?",
    });
  });

  it("keeps the flagged warning", () => {
    const warning = buildSubmitWarning(
      [
        question(1, "UPLOAD", UPLOADED),
        question(2, "TEXT", { ...ANSWERED_TEXT, status: "flagged" }),
      ],
      {},
    );

    expect(warning).toEqual({
      message: "You have flagged questions. Are you sure you want to submit?",
    });
  });

  it("names the missing file ahead of flags", () => {
    const warning = buildSubmitWarning(
      [
        question(1, "UPLOAD"),
        question(2, "TEXT", { ...ANSWERED_TEXT, status: "flagged" }),
      ],
      {},
    );

    expect(warning?.params).toEqual({ question: 1 });
  });

  it("returns nothing when every question is answered", () => {
    expect(
      buildSubmitWarning(
        [question(1, "UPLOAD", UPLOADED), question(2, "TEXT", ANSWERED_TEXT)],
        {},
      ),
    ).toBeNull();
  });

  it("only uses templates the translation catalogs can key on", () => {
    const cases = [
      buildSubmitWarning([question(1, "UPLOAD")], {}),
      buildSubmitWarning([question(1, "UPLOAD"), question(2, "UPLOAD")], {}),
      buildSubmitWarning([question(1, "UPLOAD")], {
        uploadStatusByQuestion: { 1: "failed" },
      }),
    ];
    for (const warning of cases) {
      expect(SUBMIT_WARNING_SOURCE_STRINGS).toContain(warning?.message);
    }
  });
});

describe("getSubmitButtonStatus while a file is uploading", () => {
  it("blocks submit and names the question", () => {
    const status = getSubmitButtonStatus(
      [question(1, "TEXT", ANSWERED_TEXT), question(2, "UPLOAD")],
      false,
      true,
      false,
      [],
      { 2: "uploading" },
    );

    expect(status).toEqual({
      disabled: true,
      reason: "Wait for the file on Question 2 to finish uploading.",
    });
  });

  it("still blocks on the bare flag when no question is known", () => {
    expect(
      getSubmitButtonStatus([question(1, "TEXT", ANSWERED_TEXT)], false, true),
    ).toEqual({ disabled: true, reason: "File upload in progress..." });
  });
});

describe("unsupported recording and presentation questions", () => {
  const recording = (id: number, responseType: string) =>
    question(id, "UPLOAD", {
      responseType,
      presentationResponse: { transcript: "old draft" },
    } as Partial<QuestionStore>);

  it.each(["PRESENTATION", "VIDEO", "AUDIO", "LIVE_RECORDING"])(
    "never makes a %s question required",
    (responseType) => {
      expect(
        getSubmitButtonStatus(
          [question(1, "TEXT", ANSWERED_TEXT), recording(2, responseType)],
          false,
          false,
          true,
        ),
      ).toEqual({ disabled: false, reason: null });
    },
  );

  it("does not count a leftover draft on one as an answer", () => {
    expect(
      getSubmitButtonStatus(
        [question(1, "TEXT"), recording(2, "LIVE_RECORDING")],
        false,
      ),
    ).toEqual({ disabled: true, reason: "No questions have been answered" });
  });

  it("lets an attempt made only of them be submitted", () => {
    expect(
      getSubmitButtonStatus([recording(1, "PRESENTATION")], false, false, true),
    ).toEqual({ disabled: false, reason: null });
  });

  it("does not warn about a missing file for one", () => {
    expect(
      buildSubmitWarning(
        [question(1, "TEXT", ANSWERED_TEXT), recording(2, "PRESENTATION")],
        {},
      ),
    ).toBeNull();
  });
});
