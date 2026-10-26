import { normalizeExcelQuizRows } from "../excelQuizRows";
const headers = [
  "Question text",
  "CORRECT ANSWER",
  "Answer 2",
  "Answer 3",
  "Answer 4",
];
describe("Excel quiz answer-key mapping", () => {
  it("preserves the documented template", () => {
    expect(
      normalizeExcelQuizRows([headers, ["2+2?", "4", "3", "5", "6"]])[1],
    ).toEqual(["2+2?", "4", "3", "5", "6", "", ""]);
  });
  it("maps reordered headers and feedback", () => {
    expect(
      normalizeExcelQuizRows([
        [
          "Answer 2",
          "question_TEXT",
          "Answer 4",
          "Additional Info",
          "Answer 3",
          " Correct ANSWER ",
        ],
        ["3", "2+2?", "6", "Explanation", "5", "4"],
      ])[1],
    ).toEqual(["2+2?", "4", "3", "5", "6", "", "Explanation"]);
  });
  it("rejects an unmarked key instead of choosing the first option", () => {
    expect(() =>
      normalizeExcelQuizRows([
        ["Question text", "Answer 1", "Answer 2", "Answer 3", "Answer 4"],
      ]),
    ).toThrow('Missing Excel header: "correct answer"');
  });
  it("rejects duplicate key columns", () => {
    expect(() =>
      normalizeExcelQuizRows([[...headers, "Correct answer"]]),
    ).toThrow('Duplicate Excel header: "correct answer"');
  });
  it.each([
    [["2+2?", "", "3", "5", "6"], "Correct answer text is required"],
    [["2+2?", "4", " 4 ", "5", "6"], "Answer choices must be distinct"],
    [["2+2?", "4", "", "", ""], "At least two answer choices"],
    [["", "4", "3", "5", "6"], "Question text is required"],
  ])(
    "rejects invalid rows with their spreadsheet row number",
    (row, message) => {
      expect(() => normalizeExcelQuizRows([headers, [], row])).toThrow(
        `Excel row 3: ${message}`,
      );
    },
  );
});
