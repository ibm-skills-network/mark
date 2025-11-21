import { DataTransformer } from "../data-transformer";
import { API_ENCODE_CONFIG, API_DECODE_CONFIG } from "../transform-config";

/**
 * Test suite specifically for choice and feedback field encoding/decoding
 * This ensures that the fix for choice/feedback decoding doesn't regress
 */
describe("Choice and Feedback Decoding", () => {
  describe("Single Question with Choices", () => {
    it("should encode and decode choice text", () => {
      const originalData = {
        type: "SINGLE_CORRECT",
        question:
          "<p>Which SQL query correctly retrieves the first 100 rows?</p>",
        choices: [
          {
            choice: "SELECT * FROM sales_detail LIMIT 100;",
            isCorrect: true,
            points: 1,
            feedback: "Correct. This query uses the LIMIT clause.",
          },
          {
            choice: "SELECT TOP 100 * FROM sales_detail;",
            isCorrect: false,
            points: 0,
            feedback:
              "Incorrect. The TOP keyword is used in SQL Server, not PostgreSQL.",
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );

      expect(encoded.question).not.toBe(originalData.question);
      expect(encoded.question).toMatch(/^[A-Za-z0-9+/]+=*$/);

      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.question).toBe(originalData.question);
      expect(decoded.choices[0].choice).toBe(originalData.choices[0].choice);
      expect(decoded.choices[0].feedback).toBe(
        originalData.choices[0].feedback,
      );
      expect(decoded.choices[1].choice).toBe(originalData.choices[1].choice);
      expect(decoded.choices[1].feedback).toBe(
        originalData.choices[1].feedback,
      );
    });

    it("should handle choices with HTML content", () => {
      const originalData = {
        type: "MULTIPLE_CORRECT",
        question: "<p>Select all correct statements:</p>",
        choices: [
          {
            choice: "<p>HTML can contain <strong>bold</strong> text</p>",
            isCorrect: true,
            feedback: "<p>Correct! HTML supports <em>formatting</em> tags.</p>",
          },
          {
            choice: "<p>SQL is a programming language</p>",
            isCorrect: false,
            feedback: "<p>Incorrect. SQL is a query language.</p>",
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );

      expect(encoded.question).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encoded.choices[0].choice).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encoded.choices[0].feedback).toMatch(/^[A-Za-z0-9+/]+=*$/);

      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.question).toBe(originalData.question);
      expect(decoded.choices[0].choice).toBe(originalData.choices[0].choice);
      expect(decoded.choices[0].feedback).toBe(
        originalData.choices[0].feedback,
      );
      expect(decoded.choices[1].choice).toBe(originalData.choices[1].choice);
      expect(decoded.choices[1].feedback).toBe(
        originalData.choices[1].feedback,
      );
    });

    it("should handle empty or missing feedback", () => {
      const originalData = {
        type: "SINGLE_CORRECT",
        question: "<p>Test question</p>",
        choices: [
          {
            choice: "Option A",
            isCorrect: true,
            feedback: "",
          },
          {
            choice: "Option B",
            isCorrect: false,
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.choices[0].feedback).toBe("");
      expect(decoded.choices[1].feedback).toBeUndefined();
    });
  });

  describe("Multiple Questions with Choices", () => {
    it("should decode choices in questions array", () => {
      const originalData = {
        id: 1,
        title: "SQL Quiz",
        questions: [
          {
            type: "SINGLE_CORRECT",
            question: "<p>What is SQL?</p>",
            choices: [
              {
                choice: "Structured Query Language",
                isCorrect: true,
                feedback: "Correct! SQL stands for Structured Query Language.",
              },
              {
                choice: "Simple Question Language",
                isCorrect: false,
                feedback:
                  "Incorrect. SQL stands for Structured Query Language.",
              },
            ],
          },
          {
            type: "SINGLE_CORRECT",
            question: "<p>What does SELECT do?</p>",
            choices: [
              {
                choice: "Retrieves data from a database",
                isCorrect: true,
                feedback: "Correct! SELECT is used to query data.",
              },
              {
                choice: "Deletes data from a database",
                isCorrect: false,
                feedback: "Incorrect. DELETE is used to remove data.",
              },
            ],
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.questions[0].question).toBe(
        originalData.questions[0].question,
      );
      expect(decoded.questions[0].choices[0].choice).toBe(
        originalData.questions[0].choices[0].choice,
      );
      expect(decoded.questions[0].choices[0].feedback).toBe(
        originalData.questions[0].choices[0].feedback,
      );

      expect(decoded.questions[1].question).toBe(
        originalData.questions[1].question,
      );
      expect(decoded.questions[1].choices[0].choice).toBe(
        originalData.questions[1].choices[0].choice,
      );
      expect(decoded.questions[1].choices[1].feedback).toBe(
        originalData.questions[1].choices[1].feedback,
      );
    });
  });

  describe("Nested Choice Structures", () => {
    it("should handle deeply nested choices", () => {
      const originalData = {
        assignment: {
          questions: [
            {
              question: "<p>Nested question</p>",
              choices: [
                {
                  choice: "<strong>Nested choice</strong>",
                  feedback: "<em>Nested feedback</em>",
                },
              ],
            },
          ],
        },
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.assignment.questions[0].question).toBe(
        originalData.assignment.questions[0].question,
      );
      expect(decoded.assignment.questions[0].choices[0].choice).toBe(
        originalData.assignment.questions[0].choices[0].choice,
      );
      expect(decoded.assignment.questions[0].choices[0].feedback).toBe(
        originalData.assignment.questions[0].choices[0].feedback,
      );
    });
  });

  describe("Real-world API Response Format", () => {
    it("should decode the exact format from the bug report", () => {
      const apiResponse = [
        {
          type: "SINGLE_CORRECT",
          responseType: "OTHER",
          question:
            "PHA+V2hpY2ggU1FMIHF1ZXJ5IGNvcnJlY3RseSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzIGZyb20gdGhlIHNhbGVzX2RldGFpbCB0YWJsZSBpbiBQb3N0Z3JlU1FMPzwvcD4=",
          maxWords: null,
          maxCharacters: null,
          totalPoints: 2,
          choices: [
            {
              choice: "SELECT * FROM sales_detail LIMIT 100;",
              isCorrect: true,
              points: 1,
              feedback:
                "Correct. This query uses the LIMIT clause to retrieve the first 100 rows from the sales_detail table in PostgreSQL.",
            },
            {
              choice: "SELECT TOP 100 * FROM sales_detail;",
              isCorrect: false,
              points: 0,
              feedback:
                "Incorrect. The TOP keyword is used in SQL Server, not PostgreSQL. PostgreSQL uses LIMIT.",
            },
          ],
          scoring: null,
          randomizedChoices: true,
          gradingContextQuestionIds: [],
          displayOrder: 1,
          variants: [],
          index: 1,
          id: 6998,
          assignmentId: 1,
        },
      ];

      const decoded = DataTransformer.decodeFromAPI(
        apiResponse,
        API_DECODE_CONFIG,
      );

      expect(decoded[0].question).toBe(
        "<p>Which SQL query correctly retrieves the first 100 rows from the sales_detail table in PostgreSQL?</p>",
      );

      expect(decoded[0].choices[0].choice).toBe(
        "SELECT * FROM sales_detail LIMIT 100;",
      );
      expect(decoded[0].choices[0].feedback).toBe(
        "Correct. This query uses the LIMIT clause to retrieve the first 100 rows from the sales_detail table in PostgreSQL.",
      );
      expect(decoded[0].choices[1].choice).toBe(
        "SELECT TOP 100 * FROM sales_detail;",
      );
      expect(decoded[0].choices[1].feedback).toBe(
        "Incorrect. The TOP keyword is used in SQL Server, not PostgreSQL. PostgreSQL uses LIMIT.",
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle choices array at the root level", () => {
      const originalData = {
        choices: [
          {
            choice: "Root level choice",
            feedback: "Root level feedback",
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.choices[0].choice).toBe(originalData.choices[0].choice);
      expect(decoded.choices[0].feedback).toBe(
        originalData.choices[0].feedback,
      );
    });

    it("should handle special characters in choices", () => {
      const originalData = {
        question: "<p>Test</p>",
        choices: [
          {
            choice: "Choice with 'quotes' and \"double quotes\"",
            feedback: "Feedback with <tags> & special chars: éñ中文",
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.choices[0].choice).toBe(originalData.choices[0].choice);
      expect(decoded.choices[0].feedback).toBe(
        originalData.choices[0].feedback,
      );
    });

    it("should handle very long choice text", () => {
      const longText = "A".repeat(2000);
      const originalData = {
        choices: [
          {
            choice: longText,
            feedback: longText,
          },
        ],
      };

      const { data: encoded } = DataTransformer.encodeForAPI(
        originalData,
        API_ENCODE_CONFIG,
      );
      const decoded = DataTransformer.decodeFromAPI(encoded, API_DECODE_CONFIG);

      expect(decoded.choices[0].choice).toBe(originalData.choices[0].choice);
      expect(decoded.choices[0].feedback).toBe(
        originalData.choices[0].feedback,
      );
    });
  });

  describe("Config Consistency", () => {
    it("should have choice and feedback fields in encode config (specific paths only)", () => {
      expect(API_ENCODE_CONFIG.fields).not.toContain("choice");
      expect(API_ENCODE_CONFIG.fields).not.toContain("feedback");

      expect(API_ENCODE_CONFIG.fields).toContain("choices.choice");
      expect(API_ENCODE_CONFIG.fields).toContain("choices.feedback");
      expect(API_ENCODE_CONFIG.fields).toContain("questions.choices.choice");
      expect(API_ENCODE_CONFIG.fields).toContain("questions.choices.feedback");
    });

    it("should have choice and feedback fields in decode config (specific paths only)", () => {
      expect(API_DECODE_CONFIG.fields).not.toContain("choice");
      expect(API_DECODE_CONFIG.fields).not.toContain("feedback");

      expect(API_DECODE_CONFIG.fields).toContain("choices.choice");
      expect(API_DECODE_CONFIG.fields).toContain("choices.feedback");
      expect(API_DECODE_CONFIG.fields).toContain("questions.choices.choice");
      expect(API_DECODE_CONFIG.fields).toContain("questions.choices.feedback");
    });

    it("should have matching fields in encode and decode configs", () => {
      const encodeFields = API_ENCODE_CONFIG.fields?.sort();
      const decodeFields = API_DECODE_CONFIG.fields?.sort();

      expect(encodeFields).toEqual(decodeFields);
    });
  });
});
