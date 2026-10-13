import { selectedChoiceTexts } from "@/lib/learner-choice-submission";
import type { QuestionStore } from "@/config/types";
import { DataTransformer } from "../data-transformer";
import { API_DECODE_CONFIG, API_ENCODE_CONFIG } from "../transform-config";

const toBase64 = (text: string): string =>
  btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCodePoint(byte),
    ).join(""),
  );

const fromBase64 = (value: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0),
  );

/**
 * The API sends choice text base64-encoded. Choice text that happens to read
 * as a JSON number must come back as the same text, or the learner sees and
 * submits a different value than the one the grader matches against.
 */
describe("numeric-looking choice text survives the API round trip", () => {
  const authored = ["1.621", "1.692", "1.620", "1.653"];
  const trailingZero = ["4.1", "4.0", "3.0", "1.0"];

  const attemptPayload = (texts: string[]) => ({
    questions: [
      {
        id: 1,
        type: "SINGLE_CORRECT",
        choices: texts.map((text, index) => ({
          choice: toBase64(text),
          isCorrect: index === 1,
          points: index === 1 ? 2 : 0,
          feedback: toBase64("Feedback"),
        })),
      },
    ],
  });

  it.each([
    ["trailing zero in a decimal", authored],
    ["whole number written with .0", trailingZero],
  ])("decodes %s choices verbatim", (_label, texts) => {
    const decoded = DataTransformer.decodeFromAPI(
      attemptPayload(texts),
      API_DECODE_CONFIG,
    ) as { questions: { choices: { choice: unknown }[] }[] };

    expect(decoded.questions[0].choices.map((c) => c.choice)).toEqual(texts);
  });

  it("submits the exact text of the selected numeric choice", () => {
    const decoded = DataTransformer.decodeFromAPI(
      attemptPayload(authored),
      API_DECODE_CONFIG,
    ) as { questions: QuestionStore[] };

    const question = { ...decoded.questions[0], learnerChoices: ["2"] };
    const { texts } = selectedChoiceTexts(question, "en");

    const { data } = DataTransformer.encodeForAPI(
      { responsesForQuestions: [{ id: 1, learnerChoices: texts }] },
      API_ENCODE_CONFIG,
    );
    const sent = (
      data as { responsesForQuestions: { learnerChoices: unknown[] }[] }
    ).responsesForQuestions[0].learnerChoices.map((value) =>
      typeof value === "string" ? fromBase64(value) : value,
    );

    expect(sent).toEqual(["1.620"]);
  });

  it.each(["true", "null", "42"])(
    "keeps the primitive-looking text %s as text",
    (text) => {
      const decoded = DataTransformer.decodeFromAPI(
        { choices: [{ choice: toBase64(text) }] },
        API_DECODE_CONFIG,
      ) as { choices: { choice: unknown }[] };

      expect(decoded.choices[0].choice).toBe(text);
    },
  );

  it("still decodes structured JSON the server stringified", () => {
    const value = { key: "value", number: 42 };
    const decoded = DataTransformer.decodeFromAPI(
      { content: toBase64(JSON.stringify(value)) },
      API_DECODE_CONFIG,
    ) as { content: unknown };

    expect(decoded.content).toEqual(value);
  });

  it("keeps a learnerChoices item that reads as JSON as the text it was", () => {
    const decoded = DataTransformer.decodeFromAPI(
      { learnerChoices: [toBase64("[1, 2]"), toBase64("1.50")] },
      API_DECODE_CONFIG,
    ) as { learnerChoices: unknown[] };

    expect(decoded.learnerChoices).toEqual(["[1, 2]", "1.50"]);
  });
});
