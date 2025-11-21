/* eslint-disable */
import { DataTransformer } from "./data-transformer";

/**
 * Real-world scenario tests for web data transformer
 * Tests actual assignment/question/rubric structures from API responses
 */
describe("DataTransformer Web - Real-World Scenarios", () => {
  describe("API Response Decoding", () => {
    it("should decode a complete assignment from API", () => {
      const apiResponse = {
        id: 1025,
        name: "SQL Fundamentals",
        introduction:
          "PHA+VGhpcyBhc3NpZ25tZW50IHRlc3RzIHlvdXIgU1FMIGtub3dsZWRnZS48L3A+",
        instructions:
          "PHA+Q29tcGxldGUgYWxsIHF1ZXN0aW9ucyB0byB0aGUgYmVzdCBvZiB5b3VyIGFiaWxpdHkuPC9wPg==",
        questions: [
          {
            id: 2246,
            question:
              "PHA+V2hpY2ggU1FMIHF1ZXJ5IHJldHJpZXZlcyB0aGUgZmlyc3QgMTAwIHJvd3M/PC9wPg==",
            choices: [
              {
                choice: "U0VMRUNUICogRlJPTSBzYWxlc19kZXRhaWwgTElNSVQgMTAwOw==",
                feedback: "Q29ycmVjdCEgVXNlcyB0aGUgTElNSVQgY2xhdXNlLg==",
              },
            ],
          },
        ],
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: [
          "introduction",
          "instructions",
          "questions.question",
          "questions.choices.choice",
          "questions.choices.feedback",
        ],
        deep: true,
      });

      expect(decoded.introduction).toContain("SQL knowledge");
      expect(decoded.instructions).toContain("Complete all questions");
      expect(decoded.questions[0].question).toContain("Which SQL query");
      expect(decoded.questions[0].choices[0].choice).toContain("SELECT * FROM");
      expect(decoded.questions[0].choices[0].feedback).toContain("Correct!");
    });

    it("should handle API response with questionVersions", () => {
      const apiResponse = {
        id: 1025,
        questionVersions: [
          {
            id: 2246,
            question: "PHA+V2hhdCBpcyB0aGUgb3V0cHV0IG9mIDIrMj88L3A+",
            choices: [
              {
                choice: "Mw==",
                feedback: "SW5jb3JyZWN0",
              },
              {
                choice: "NA==",
                feedback: "Q29ycmVjdCE=",
              },
            ],
            scoring: {
              rubrics: [
                {
                  rubricQuestion:
                    "RGlkIHRoZSBsZWFybmVyIGFuc3dlciBjb3JyZWN0bHk/",
                  criteria: [
                    {
                      description: "SW5jb3JyZWN0IGFuc3dlcg==",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: [
          "questionVersions.question",
          "questionVersions.choices.choice",
          "questionVersions.choices.feedback",
          "questionVersions.scoring.rubrics.rubricQuestion",
          "questionVersions.scoring.rubrics.criteria.description",
        ],
        deep: true,
      });

      expect(decoded.questionVersions[0].question).toContain("2+2");
      expect(decoded.questionVersions[0].choices[0].choice).toEqual(3);
      expect(decoded.questionVersions[0].choices[1].choice).toEqual(4);
      expect(
        decoded.questionVersions[0].scoring.rubrics[0].rubricQuestion,
      ).toContain("answer correctly");
      expect(
        decoded.questionVersions[0].scoring.rubrics[0].criteria[0].description,
      ).toContain("Incorrect");
    });
  });

  describe("Frontend to Backend Communication", () => {
    it("should encode assignment data for API submission", () => {
      const userInput = {
        learnerTextResponse:
          "I would use SELECT * FROM table LIMIT 100 because it's the PostgreSQL syntax.",
        attemptId: 123,
        questionId: 456,
      };

      const encoded = DataTransformer.encodeForAPI(userInput, {
        fields: ["learnerTextResponse"],
      });

      expect(encoded.data.learnerTextResponse).not.toBe(
        userInput.learnerTextResponse,
      );
      expect(encoded.data.attemptId).toBe(123);
      expect(encoded.data.questionId).toBe(456);

      expect(encoded.data.learnerTextResponse).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should handle submission with choices", () => {
      const submission = {
        attemptId: 789,
        learnerChoices: [
          { questionId: 1, selectedChoiceId: 2 },
          { questionId: 2, selectedChoiceId: 5 },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(submission, {
        fields: ["learnerChoices"],
      });

      expect(encoded.data.attemptId).toBe(789);
      expect(encoded.data.learnerChoices).toBeDefined();
    });
  });

  describe("Complex Rubric Scenarios", () => {
    it("should handle multi-criteria rubrics from API", () => {
      const apiResponse = {
        scoring: {
          rubrics: [
            {
              rubricQuestion:
                "RGlkIHRoZSBsZWFybmVyIGNyZWF0ZSBhIC5naXRodWIvSVNTVUVfVEVNUExBVEUgZm9sZGVyPw==",
              criteria: [
                {
                  points: 0,
                  description: "Tm8gSVNTVUVfVEVNUExBVEUgZm9sZGVyIGZvdW5k",
                },
                {
                  points: 1,
                  description:
                    "SVNTVUVfVEVNUExBVEUgZm9sZGVyIGV4aXN0cyB3aXRoIHRlbXBsYXRlcw==",
                },
              ],
            },
            {
              rubricQuestion:
                "RG9lcyB0aGUgUkVBRE1FLm1kIGNvbnRhaW4gaW5zdGFsbGF0aW9uIGluc3RydWN0aW9ucz8=",
              criteria: [
                {
                  points: 0,
                  description: "Tm8gaW5zdGFsbGF0aW9uIGluc3RydWN0aW9ucw==",
                },
                {
                  points: 1,
                  description:
                    "Q2xlYXIgaW5zdGFsbGF0aW9uIGluc3RydWN0aW9ucyBwcm92aWRlZA==",
                },
              ],
            },
          ],
        },
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: [
          "scoring.rubrics.rubricQuestion",
          "scoring.rubrics.criteria.description",
        ],
        deep: true,
      });

      expect(decoded.scoring.rubrics).toHaveLength(2);
      expect(decoded.scoring.rubrics[0].rubricQuestion).toContain(
        ".github/ISSUE_TEMPLATE",
      );
      expect(decoded.scoring.rubrics[1].rubricQuestion).toContain("README.md");
      expect(decoded.scoring.rubrics[0].criteria[1].description).toContain(
        "templates",
      );
    });
  });

  describe("Rich Text Editor Content", () => {
    it("should handle content from rich text editor", () => {
      const editorContent = {
        question: `<div class="editor-content">
          <h2>Question Title</h2>
          <p>This question tests your <strong>understanding</strong> of:</p>
          <ul>
            <li>Concept A</li>
            <li>Concept B</li>
          </ul>
          <pre><code class="language-python">
def hello():
    print("Hello, World!")
</code></pre>
        </div>`,
      };

      const encoded = DataTransformer.encodeForAPI(editorContent, {
        fields: ["question"],
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["question"],
      });

      expect(decoded.question).toContain("Question Title");
      expect(decoded.question).toContain("def hello()");
      expect(decoded.question).toContain("Concept A");
    });

    it("should preserve formatting in feedback", () => {
      const feedback = {
        feedback: `<div>
          <p><strong>Great job!</strong> Your answer demonstrates:</p>
          <ol>
            <li>Correct syntax usage</li>
            <li>Proper indentation</li>
            <li>Following best practices</li>
          </ol>
          <p>For improvement, consider: <em>adding comments</em></p>
        </div>`,
      };

      const encoded = DataTransformer.encodeForAPI(feedback, {
        fields: ["feedback"],
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["feedback"],
      });

      expect(decoded.feedback).toContain("Great job!");
      expect(decoded.feedback).toContain("<ol>");
      expect(decoded.feedback).toContain("adding comments");
    });
  });

  describe("Internationalization Scenarios", () => {
    it("should handle multilingual content", () => {
      const multilingualData = {
        question: "¿Qué es Python? Python是什么？ Pythonとは何ですか？",
        choices: [
          {
            choice: "Un lenguaje de programación",
            feedback: "¡Correcto! 正しい！",
          },
          {
            choice: "一种编程语言",
            feedback: "正确！ Correct!",
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(multilingualData, {
        fields: ["question", "choices.choice", "choices.feedback"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["question", "choices.choice", "choices.feedback"],
        deep: true,
      });

      expect(decoded.question).toBe(multilingualData.question);
      expect(decoded.choices[0].choice).toBe(
        multilingualData.choices[0].choice,
      );
      expect(decoded.choices[0].feedback).toContain("¡Correcto!");
      expect(decoded.choices[1].feedback).toContain("正确！");
    });
  });

  describe("Real User Submissions", () => {
    it("should handle long-form text responses", () => {
      const submission = {
        learnerTextResponse: `In my implementation, I chose to use the LIMIT clause because:

1. It's the standard PostgreSQL syntax for limiting result sets
2. It's more readable than alternatives
3. It performs well with proper indexing

Here's my reasoning:
- The LIMIT clause is applied after the WHERE clause
- It reduces the amount of data transferred
- Most modern SQL databases support this syntax

Code example:
SELECT column1, column2
FROM large_table
WHERE condition = true
ORDER BY column1
LIMIT 100;

This approach is efficient because it stops scanning after finding 100 rows.`,
      };

      const encoded = DataTransformer.encodeForAPI(submission, {
        fields: ["learnerTextResponse"],
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse"],
      });

      expect(decoded.learnerTextResponse).toBe(submission.learnerTextResponse);
      expect(decoded.learnerTextResponse).toContain("LIMIT clause");
      expect(decoded.learnerTextResponse).toContain("Code example:");
    });

    it("should handle code submissions with special characters", () => {
      const submission = {
        learnerTextResponse: `function validateInput(str) {
  // Check for special chars: !@#$%^&*()
  const regex = /[!@#$%^&*()]/g;
  return !regex.test(str);
}

// Test cases:
console.log(validateInput("Hello")); // true
console.log(validateInput("Hello!")); // false`,
      };

      const encoded = DataTransformer.encodeForAPI(submission, {
        fields: ["learnerTextResponse"],
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse"],
      });

      expect(decoded.learnerTextResponse).toContain("!@#$%^&*()");
      expect(decoded.learnerTextResponse).toContain("regex.test");
    });
  });

  describe("Pagination and List Responses", () => {
    it("should handle paginated assignment lists", () => {
      const paginatedResponse = {
        data: Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          name: `Assignment ${i + 1}`,
          introduction: Buffer.from(
            `<p>Introduction for assignment ${i + 1}</p>`,
          ).toString("base64"),
        })),
        page: 1,
        total: 100,
      };

      const decoded = DataTransformer.decodeFromAPI(paginatedResponse, {
        fields: ["data.introduction"],
        deep: true,
      });

      expect(decoded.data).toHaveLength(20);
      expect(decoded.data[0].introduction).toContain("Introduction for");
      expect(decoded.data[19].introduction).toContain("assignment 20");
      expect(decoded.page).toBe(1);
      expect(decoded.total).toBe(100);
    });
  });

  describe("Error Responses", () => {
    it("should handle API error responses gracefully", () => {
      const errorResponse = {
        error: true,
        message: "Invalid assignment ID",
        details: null,
      };

      expect(() => {
        const decoded = DataTransformer.decodeFromAPI(errorResponse, {
          fields: ["message"],
        });
        expect(decoded.error).toBe(true);
        expect(decoded.message).toBe("Invalid assignment ID");
      }).not.toThrow();
    });

    it("should handle partial API responses", () => {
      const partialResponse = {
        id: 123,
        name: "Test",
      };

      expect(() => {
        const decoded = DataTransformer.decodeFromAPI(partialResponse, {
          fields: ["question", "choices.choice"],
          deep: true,
        });
        expect(decoded.id).toBe(123);
      }).not.toThrow();
    });
  });

  describe("Mixed Encoded/Plain Data", () => {
    it("should handle responses with some fields encoded and others plain", () => {
      const mixedResponse = {
        id: 456,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-15T12:00:00Z",
        question: "PHA+V2hhdCBpcyBKYXZhU2NyaXB0PzwvcD4=",
        metadata: {
          author: "John Doe",
          version: 2,
        },
        choices: [
          {
            id: 1,
            choice: "QSBwcm9ncmFtbWluZyBsYW5ndWFnZQ==",
            isCorrect: true,
          },
        ],
      };

      const decoded = DataTransformer.decodeFromAPI(mixedResponse, {
        fields: ["question", "choices.choice"],
        deep: true,
      });

      expect(decoded.id).toBe(456);
      expect(decoded.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(decoded.metadata.author).toBe("John Doe");

      expect(decoded.question).toContain("JavaScript");
      expect(decoded.choices[0].choice).toContain("programming language");

      expect(decoded.choices[0].isCorrect).toBe(true);
    });
  });

  describe("Performance with Real Data Volumes", () => {
    it("should handle typical assignment with 50 questions efficiently", () => {
      const largeAssignment = {
        questions: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          question: Buffer.from(`<p>Question ${i + 1} content</p>`).toString(
            "base64",
          ),
          choices: Array.from({ length: 4 }, (_, j) => ({
            id: j + 1,
            choice: Buffer.from(
              `Choice ${j + 1} for question ${i + 1}`,
            ).toString("base64"),
            feedback: Buffer.from(
              `Feedback ${j + 1} for question ${i + 1}`,
            ).toString("base64"),
          })),
        })),
      };

      const startTime = performance.now();
      const decoded = DataTransformer.decodeFromAPI(largeAssignment, {
        fields: [
          "questions.question",
          "questions.choices.choice",
          "questions.choices.feedback",
        ],
        deep: true,
      });
      const decodeTime = performance.now() - startTime;

      expect(decoded.questions).toHaveLength(50);
      expect(decoded.questions[0].choices).toHaveLength(4);
      expect(decoded.questions[49].question).toContain("Question 50");

      expect(decodeTime).toBeLessThan(2000);
    });
  });

  describe("State Management Integration", () => {
    it("should work with typical state update patterns", () => {
      const currentState = {
        assignments: [],
      };

      const apiResponse = {
        id: 1,
        name: "New Assignment",
        question: "PHA+TmV3IHF1ZXN0aW9uPC9wPg==",
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: ["question"],
      });

      const newState = {
        assignments: [...currentState.assignments, decoded],
      };

      expect(newState.assignments).toHaveLength(1);
      expect(newState.assignments[0].question).toContain("New question");
    });
  });
});
