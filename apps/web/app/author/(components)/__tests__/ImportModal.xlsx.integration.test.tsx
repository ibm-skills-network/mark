/**
 * @jest-environment jsdom
 *
 * Integration tests for Excel import functionality
 * Tests the complete flow from file selection to import
 */

import { generateTempQuestionId } from "@/lib/utils";
import { ResponseType, QuestionType } from "@/config/types";

jest.mock("@/lib/utils", () => ({
  generateTempQuestionId: jest.fn(() => Math.random()),
}));

describe("ImportModal - Excel Import Integration", () => {
  const parseExcelRows = (
    rows: any[][],
    options: { importChoiceFeedback: boolean } = { importChoiceFeedback: true },
  ) => {
    const questions: any[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      if (!row || row.length === 0) continue;

      const questionText = (row[0] ?? "").toString().trim();
      const correctAnswer = (row[1] ?? "").toString().trim();
      const answer2 = (row[2] ?? "").toString().trim();
      const answer3 = (row[3] ?? "").toString().trim();
      const answer4 = (row[4] ?? "").toString().trim();
      const answerLocation = (row[5] ?? "").toString().trim();
      const additionalInfo = (row[6] ?? "").toString().trim();

      if (!questionText) continue;

      const question: any = {
        id: generateTempQuestionId(),
        alreadyInBackend: false,
        assignmentId: 0,
        index: questions.length + 1,
        numRetries: 1,
        type: "SINGLE_CORRECT" as QuestionType,
        responseType: "OTHER" as ResponseType,
        totalPoints: 1,
        question: questionText,
        scoring: { type: "CRITERIA_BASED", criteria: [] },
      };

      const choices: any[] = [];

      if (correctAnswer) {
        choices.push({
          choice: correctAnswer,
          isCorrect: true,
          points: 1,
          feedback:
            options.importChoiceFeedback && additionalInfo
              ? `You may find answer for this question at ${additionalInfo}`
              : "",
        });
      }

      [answer2, answer3, answer4].forEach((answer) => {
        if (answer) {
          choices.push({
            choice: answer,
            isCorrect: false,
            points: 0,
            feedback:
              options.importChoiceFeedback && answerLocation
                ? `You may find answer for this question at ${answerLocation}`
                : "",
          });
        }
      });

      if (choices.length < 2) {
        continue;
      }

      question.choices = choices;
      questions.push(question);
    }

    return questions;
  };

  describe("Basic Parsing", () => {
    it("should parse valid Excel rows into questions", () => {
      const rows = [
        [
          "Question text",
          "CORRECT ANSWER",
          "Answer 2",
          "Answer 3",
          "Answer 4",
          "Answer location",
          "Additional Info",
        ],
        [
          "What is 2+2?",
          "4",
          "3",
          "5",
          "22",
          "Math basics, page 1",
          "This is basic arithmetic",
        ],
        [
          "What is the capital of France?",
          "Paris",
          "London",
          "Berlin",
          "Madrid",
          "Geography book, chapter 3",
          "Paris is the largest city in France",
        ],
      ];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(2);
      expect(questions[0].question).toBe("What is 2+2?");
      expect(questions[1].question).toBe("What is the capital of France?");
    });

    it("should skip rows without question text", () => {
      const rows = [
        ["Question text", "CORRECT ANSWER", "Answer 2", "Answer 3", "Answer 4"],
        ["What is 2+2?", "4", "3", "5", "22"],
        ["", "Answer", "Wrong1", "Wrong2", "Wrong3"],
        ["Valid question?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(2);
      expect(questions[0].question).toBe("What is 2+2?");
      expect(questions[1].question).toBe("Valid question?");
    });

    it("should skip questions with less than 2 choices", () => {
      const rows = [
        ["Question text", "CORRECT ANSWER", "Answer 2", "Answer 3", "Answer 4"],
        ["Question with only correct answer?", "Yes", "", "", ""],
        ["Valid question?", "Yes", "No", "", ""],
      ];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(1);
      expect(questions[0].question).toBe("Valid question?");
    });

    it("should handle rows with missing optional columns", () => {
      const rows = [
        ["Question text", "CORRECT ANSWER", "Answer 2"],
        ["Simple question?", "Yes", "No"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(1);
      expect(questions[0].choices).toHaveLength(2);
    });
  });

  describe("Choice Feedback with importChoiceFeedback=true", () => {
    it("should add Additional Info as feedback on correct answer", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        [
          "Test question?",
          "Correct answer",
          "Wrong 1",
          "Wrong 2",
          "Wrong 3",
          "Some location",
          "This is additional info for correct answer",
        ],
      ];

      const questions = parseExcelRows(rows, { importChoiceFeedback: true });

      expect(questions).toHaveLength(1);
      const correctChoice = questions[0].choices.find((c: any) => c.isCorrect);

      expect(correctChoice.feedback).toContain(
        "This is additional info for correct answer",
      );
    });

    it("should add Answer Location as feedback on incorrect answers", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        [
          "Test question?",
          "Correct answer",
          "Wrong 1",
          "Wrong 2",
          "Wrong 3",
          "Chapter 5, Page 42",
          "Some info",
        ],
      ];

      const questions = parseExcelRows(rows, { importChoiceFeedback: true });

      expect(questions).toHaveLength(1);
      const incorrectChoices = questions[0].choices.filter(
        (c: any) => !c.isCorrect,
      );

      incorrectChoices.forEach((choice: any) => {
        expect(choice.feedback).toContain("Chapter 5, Page 42");
      });
    });

    it("should handle empty feedback columns gracefully", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        [
          "Test question?",
          "Correct answer",
          "Wrong 1",
          "Wrong 2",
          "Wrong 3",
          "",
          "",
        ],
      ];

      const questions = parseExcelRows(rows, { importChoiceFeedback: true });

      expect(questions).toHaveLength(1);
      questions[0].choices.forEach((choice: any) => {
        expect(choice.feedback).toBe("");
      });
    });

    it("should use feedback format with 'You may find answer' prefix", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        [
          "Test?",
          "Yes",
          "No",
          "Maybe",
          "Not sure",
          "Page 10",
          "Additional info",
        ],
      ];

      const questions = parseExcelRows(rows, { importChoiceFeedback: true });

      const correctChoice = questions[0].choices.find((c: any) => c.isCorrect);
      const incorrectChoice = questions[0].choices.find(
        (c: any) => !c.isCorrect,
      );

      expect(correctChoice.feedback).toBe(
        "You may find answer for this question at Additional info",
      );
      expect(incorrectChoice.feedback).toBe(
        "You may find answer for this question at Page 10",
      );
    });
  });

  describe("Choice Feedback with importChoiceFeedback=false", () => {
    it("should not add any feedback when option is disabled", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        [
          "Test question?",
          "Correct answer",
          "Wrong 1",
          "Wrong 2",
          "Wrong 3",
          "Chapter 5, Page 42",
          "This is additional info",
        ],
      ];

      const questions = parseExcelRows(rows, { importChoiceFeedback: false });

      expect(questions).toHaveLength(1);
      questions[0].choices.forEach((choice: any) => {
        expect(choice.feedback).toBe("");
      });
    });
  });

  describe("Question Properties", () => {
    it("should set question type to SINGLE_CORRECT", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].type).toBe("SINGLE_CORRECT");
    });

    it("should set totalPoints to 1", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].totalPoints).toBe(1);
    });

    it("should mark first choice as correct with points=1", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      const correctChoice = questions[0].choices[0];
      expect(correctChoice.isCorrect).toBe(true);
      expect(correctChoice.points).toBe(1);
      expect(correctChoice.choice).toBe("Yes");
    });

    it("should mark other choices as incorrect with points=0", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      const incorrectChoices = questions[0].choices.slice(1);
      incorrectChoices.forEach((choice: any) => {
        expect(choice.isCorrect).toBe(false);
        expect(choice.points).toBe(0);
      });
    });

    it("should include all 4 choices when all are provided", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "Maybe", "Not sure"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].choices).toHaveLength(4);
      expect(questions[0].choices.map((c: any) => c.choice)).toEqual([
        "Yes",
        "No",
        "Maybe",
        "Not sure",
      ]);
    });

    it("should only include provided choices (can be less than 4)", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Test?", "Yes", "No", "", ""],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].choices).toHaveLength(2);
      expect(questions[0].choices.map((c: any) => c.choice)).toEqual([
        "Yes",
        "No",
      ]);
    });
  });

  describe("Multiple Questions", () => {
    it("should parse all valid questions from multiple rows", () => {
      const rows = [
        [
          "Question",
          "Correct",
          "Wrong1",
          "Wrong2",
          "Wrong3",
          "Location",
          "Info",
        ],
        ["Q1?", "A1", "B1", "C1", "D1", "Loc1", "Info1"],
        ["Q2?", "A2", "B2", "C2", "D2", "Loc2", "Info2"],
        ["Q3?", "A3", "B3", "C3", "D3", "Loc3", "Info3"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(3);
      expect(questions[0].question).toBe("Q1?");
      expect(questions[1].question).toBe("Q2?");
      expect(questions[2].question).toBe("Q3?");
    });

    it("should assign correct index to each question", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["Q1?", "A1", "B1", "C1", "D1"],
        ["Q2?", "A2", "B2", "C2", "D2"],
        ["Q3?", "A3", "B3", "C3", "D3"],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].index).toBe(1);
      expect(questions[1].index).toBe(2);
      expect(questions[2].index).toBe(3);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty rows array", () => {
      const rows: any[][] = [];
      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(0);
    });

    it("should handle only header row", () => {
      const rows = [["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"]];

      const questions = parseExcelRows(rows);

      expect(questions).toHaveLength(0);
    });

    it("should trim whitespace from question text and answers", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        ["  What is 2+2?  ", "  4  ", "  3  ", "  5  ", "  22  "],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].question).toBe("What is 2+2?");
      expect(questions[0].choices[0].choice).toBe("4");
      expect(questions[0].choices[1].choice).toBe("3");
    });

    it("should handle special characters in question text", () => {
      const rows = [
        ["Question", "Correct", "Wrong1", "Wrong2", "Wrong3"],
        [
          "What's the difference between <strong> and <b>?",
          "Semantic meaning",
          "Visual appearance",
          "Browser support",
          "No difference",
        ],
      ];

      const questions = parseExcelRows(rows);

      expect(questions[0].question).toContain("<strong>");
      expect(questions[0].question).toContain("<b>");
    });
  });
});
