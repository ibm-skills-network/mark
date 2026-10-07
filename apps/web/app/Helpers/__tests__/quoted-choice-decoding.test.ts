import { DataTransformer } from "../data-transformer";
import { API_DECODE_CONFIG } from "../transform-config";

/**
 * The API base64-encodes choice text exactly as the author wrote it. A choice
 * wrapped in quotation marks must come back with its quotes, because the
 * learner submits the decoded text and the grader matches it against the
 * authored choice.
 */
const asServerSends = (text: string) =>
  Buffer.from(text, "utf8").toString("base64");

describe("Decoding text the author wrapped in quotation marks", () => {
  const quotedChoice =
    '"We are very error-prone and constantly have to go back to check/fix work."';

  it("keeps the quotes on a decoded choice", () => {
    const decoded = DataTransformer.decodeFromAPI(
      {
        questions: [
          {
            id: 12_218,
            choices: [
              { choice: asServerSends(quotedChoice), isCorrect: true },
              { choice: asServerSends('"We rarely make mistakes."') },
            ],
          },
        ],
      },
      API_DECODE_CONFIG,
    );

    expect(decoded.questions[0].choices[0].choice).toBe(quotedChoice);
    expect(decoded.questions[0].choices[1].choice).toBe(
      '"We rarely make mistakes."',
    );
  });

  it("keeps the quotes on a decoded learner choice and question text", () => {
    const decoded = DataTransformer.decodeFromAPI(
      {
        question: asServerSends('"Quoted question"'),
        learnerChoices: [asServerSends(quotedChoice)],
      },
      API_DECODE_CONFIG,
    );

    expect(decoded.question).toBe('"Quoted question"');
    expect(decoded.learnerChoices[0]).toBe(quotedChoice);
  });

  it("still restores a field the server sent as encoded JSON", () => {
    const decoded = DataTransformer.decodeFromAPI(
      { content: asServerSends(JSON.stringify({ a: 1, b: ["x"] })) },
      API_DECODE_CONFIG,
    );

    expect(decoded.content).toEqual({ a: 1, b: ["x"] });
  });
});
