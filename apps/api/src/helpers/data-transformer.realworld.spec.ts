/* eslint-disable */
import { DataTransformer } from "./data-transformer";

/**
 * Real-world scenario tests with actual assignment/question/rubric structures
 * These tests validate the transformer works correctly with production data
 */
describe("DataTransformer - Real-World Scenarios", () => {
  describe("Assignment with Questions and Rubrics", () => {
    it("should encode/decode a complete assignment structure", () => {
      const assignment = {
        id: 1025,
        name: "SQL Fundamentals Assessment",
        introduction:
          "<p>This assignment tests your understanding of SQL queries.</p>",
        instructions:
          "<p>Answer all questions to the best of your ability. You may use the SQL reference guide.</p>",
        gradingCriteriaOverview:
          "<p>Grading is based on correctness and code quality.</p>",
        questions: [
          {
            id: 2246,
            questionId: 6998,
            totalPoints: 2,
            type: "SINGLE_CORRECT",
            question:
              "<p>Which SQL query correctly retrieves the first 100 rows from the sales_detail table in PostgreSQL?</p>",
            choices: [
              {
                choice: "SELECT * FROM sales_detail LIMIT 100;",
                isCorrect: true,
                points: 2,
                feedback:
                  "Correct! This query retrieves the first 100 rows from the sales_detail table using the LIMIT clause.",
              },
              {
                choice: "SELECT TOP 100 * FROM sales_detail;",
                isCorrect: false,
                points: 0,
                feedback:
                  "Incorrect. The TOP clause is used in SQL Server, not in PostgreSQL.",
              },
            ],
            scoring: {
              rubrics: [
                {
                  id: 5,
                  rubricQuestion:
                    "Did the learner submit a URL showing the presence of .github/ISSUE_TEMPLATE in the repository?",
                  criteria: [
                    {
                      points: 0,
                      description:
                        "The learner did not submit a valid URL or the URL does not contain the .github/ISSUE_TEMPLATE folder.",
                    },
                    {
                      points: 1,
                      description:
                        "The learner submitted a valid URL showing the presence of the .github/ISSUE_TEMPLATE folder in the repository.",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(assignment);

      expect(encoded.data.introduction).not.toBe(assignment.introduction);
      expect(encoded.data.questions[0].question).not.toBe(
        assignment.questions[0].question,
      );
      expect(encoded.data.questions[0].choices[0].choice).not.toBe(
        assignment.questions[0].choices[0].choice,
      );

      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.id).toBe(assignment.id);
      expect(decoded.name).toBe(assignment.name);
      expect(decoded.introduction).toBe(assignment.introduction);
      expect(decoded.instructions).toBe(assignment.instructions);
      expect(decoded.gradingCriteriaOverview).toBe(
        assignment.gradingCriteriaOverview,
      );
      expect(decoded.questions[0].question).toBe(
        assignment.questions[0].question,
      );
      expect(decoded.questions[0].choices[0].choice).toBe(
        assignment.questions[0].choices[0].choice,
      );
      expect(decoded.questions[0].choices[0].feedback).toBe(
        assignment.questions[0].choices[0].feedback,
      );
      expect(decoded.questions[0].scoring.rubrics[0].rubricQuestion).toBe(
        assignment.questions[0].scoring.rubrics[0].rubricQuestion,
      );
      expect(
        decoded.questions[0].scoring.rubrics[0].criteria[0].description,
      ).toBe(
        assignment.questions[0].scoring.rubrics[0].criteria[0].description,
      );
    });

    it("should handle assignment with multiple questions", () => {
      const assignment = {
        questions: [
          {
            id: 1,
            question: "<p>Question 1: What is 2+2?</p>",
            choices: [
              { choice: "3", isCorrect: false, feedback: "Incorrect" },
              { choice: "4", isCorrect: true, feedback: "Correct!" },
            ],
          },
          {
            id: 2,
            question: "<p>Question 2: What is the capital of France?</p>",
            choices: [
              { choice: "London", isCorrect: false, feedback: "Wrong city" },
              { choice: "Paris", isCorrect: true, feedback: "Bien!" },
            ],
          },
          {
            id: 3,
            question: "<p>Question 3: Which is a programming language?</p>",
            choices: [
              {
                choice: "Python",
                isCorrect: true,
                feedback: "Yes, Python is a programming language",
              },
              {
                choice: "HTML",
                isCorrect: false,
                feedback: "HTML is a markup language",
              },
            ],
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(assignment);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.questions).toHaveLength(3);
      decoded.questions.forEach((q, i) => {
        expect(q.question).toBe(assignment.questions[i].question);
        expect(q.choices[0].choice).toBe(
          assignment.questions[i].choices[0].choice,
        );
        expect(q.choices[1].feedback).toBe(
          assignment.questions[i].choices[1].feedback,
        );
      });
    });
  });

  describe("Assignment with Question Versions", () => {
    it("should handle questionVersions structure correctly", () => {
      const assignment = {
        id: 1025,
        questionVersions: [
          {
            id: 2246,
            questionId: 6998,
            question:
              "<p>Which SQL query correctly retrieves the first 100 rows from the sales_detail table in PostgreSQL?</p>",
            choices: [
              {
                choice: "SELECT * FROM sales_detail LIMIT 100;",
                isCorrect: true,
                points: 2,
                feedback:
                  "Correct! This query retrieves the first 100 rows from the sales_detail table using the LIMIT clause.",
              },
            ],
            scoring: {
              rubrics: [
                {
                  rubricQuestion:
                    "Does the query use correct PostgreSQL syntax?",
                  criteria: [
                    {
                      points: 0,
                      description: "Uses incorrect syntax",
                    },
                    {
                      points: 2,
                      description: "Uses correct PostgreSQL LIMIT syntax",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(assignment);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.questionVersions[0].question).toBe(
        assignment.questionVersions[0].question,
      );
      expect(decoded.questionVersions[0].choices[0].choice).toBe(
        assignment.questionVersions[0].choices[0].choice,
      );
      expect(decoded.questionVersions[0].choices[0].feedback).toBe(
        assignment.questionVersions[0].choices[0].feedback,
      );
      expect(
        decoded.questionVersions[0].scoring.rubrics[0].rubricQuestion,
      ).toBe(assignment.questionVersions[0].scoring.rubrics[0].rubricQuestion);
      expect(
        decoded.questionVersions[0].scoring.rubrics[0].criteria[1].description,
      ).toBe(
        assignment.questionVersions[0].scoring.rubrics[0].criteria[1]
          .description,
      );
    });
  });

  describe("Learner Responses", () => {
    it("should handle learner text responses correctly", () => {
      const response = {
        attemptId: 123,
        learnerTextResponse:
          "The correct query is SELECT * FROM sales_detail LIMIT 100; because PostgreSQL uses the LIMIT clause to restrict the number of rows returned.",
        submittedAt: "2024-01-15T10:30:00Z",
      };

      const encoded = DataTransformer.encodeForDatabase(response);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.learnerTextResponse).toBe(response.learnerTextResponse);
      expect(decoded.submittedAt).toBe(response.submittedAt);
    });

    it("should handle learner choices correctly", () => {
      const response = {
        attemptId: 456,
        learnerChoices: JSON.stringify([
          { questionId: 1, choiceId: 2 },
          { questionId: 2, choiceId: 5 },
        ]),
      };

      const encoded = DataTransformer.encodeForDatabase(response);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      if (typeof decoded.learnerChoices === "string") {
        expect(JSON.parse(decoded.learnerChoices)).toEqual(
          JSON.parse(response.learnerChoices),
        );
      } else {
        expect(decoded.learnerChoices).toEqual(
          JSON.parse(response.learnerChoices),
        );
      }
    });
  });

  describe("Multi-Criteria Rubrics", () => {
    it("should handle multiple rubrics with multiple criteria", () => {
      const question = {
        id: 100,
        question: "<p>Create a GitHub repository with proper documentation</p>",
        scoring: {
          rubrics: [
            {
              id: 1,
              rubricQuestion:
                "Did the learner submit a URL showing the presence of .github/ISSUE_TEMPLATE in the repository?",
              criteria: [
                {
                  points: 0,
                  description:
                    "The learner did not submit a valid URL or the URL does not contain the .github/ISSUE_TEMPLATE folder.",
                },
                {
                  points: 1,
                  description:
                    "The learner submitted a valid URL showing the presence of the .github/ISSUE_TEMPLATE folder in the repository.",
                },
              ],
            },
            {
              id: 2,
              rubricQuestion:
                "Did the learner's user-story.md file contain the story template 'As a... I need... So that...'?",
              criteria: [
                {
                  points: 0,
                  description:
                    "The user-story.md file does not follow the required template.",
                },
                {
                  points: 1,
                  description:
                    "The user-story.md file correctly follows the template format.",
                },
              ],
            },
            {
              id: 3,
              rubricQuestion:
                "Does the README.md file contain installation instructions?",
              criteria: [
                {
                  points: 0,
                  description:
                    "README.md is missing or does not contain installation instructions.",
                },
                {
                  points: 1,
                  description:
                    "README.md contains clear installation instructions.",
                },
              ],
            },
          ],
        },
      };

      const encoded = DataTransformer.encodeForDatabase(question);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.scoring.rubrics).toHaveLength(3);

      decoded.scoring.rubrics.forEach((rubric, i) => {
        expect(rubric.rubricQuestion).toBe(
          question.scoring.rubrics[i].rubricQuestion,
        );
        expect(rubric.criteria).toHaveLength(2);
        rubric.criteria.forEach((criterion, j) => {
          expect(criterion.description).toBe(
            question.scoring.rubrics[i].criteria[j].description,
          );
        });
      });
    });
  });

  describe("Code Snippets in Questions", () => {
    it("should handle questions with code snippets", () => {
      const question = {
        question: `<p>What is the output of the following Python code?</p>
<pre><code class="language-python">
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(5))
</code></pre>`,
        choices: [
          {
            choice: "5",
            isCorrect: false,
            feedback: "Incorrect. Review how the Fibonacci sequence works.",
          },
          {
            choice: "8",
            isCorrect: false,
            feedback:
              "Close! But fibonacci(5) returns a different value. Trace through the recursion.",
          },
          {
            choice: "5",
            isCorrect: true,
            feedback:
              "Correct! fibonacci(5) = fibonacci(4) + fibonacci(3) = 3 + 2 = 5",
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(question);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.question).toBe(question.question);
      expect(decoded.question).toContain("def fibonacci(n):");
      expect(decoded.question).toContain("print(fibonacci(5))");
      expect(decoded.choices[2].feedback).toBe(question.choices[2].feedback);
    });

    it("should handle SQL queries in feedback", () => {
      const choice = {
        choice: "SELECT * FROM users WHERE age > 18;",
        isCorrect: true,
        feedback: `<p>Correct! The query <code>SELECT * FROM users WHERE age > 18;</code> retrieves all users older than 18.</p>
<p>Alternative solutions:</p>
<ul>
  <li><code>SELECT * FROM users WHERE age >= 19;</code></li>
  <li><code>SELECT * FROM users WHERE age BETWEEN 19 AND 999;</code></li>
</ul>`,
      };

      const encoded = DataTransformer.encodeForDatabase({
        choices: [choice],
      });
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.choices[0].choice).toBe(choice.choice);
      expect(decoded.choices[0].feedback).toBe(choice.feedback);
      expect(decoded.choices[0].feedback).toContain("SELECT * FROM users");
    });
  });

  describe("API Pass-Through Scenarios", () => {
    it("should handle API encoding/decoding with exclusions", () => {
      const apiData = {
        id: 12345,
        question: "<p>What is React?</p>",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-15T12:00:00Z",
        choices: [
          {
            choice: "A JavaScript library",
            feedback: "Correct!",
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(apiData);

      expect(encoded.data.id).toBe(apiData.id);
      expect(encoded.data.createdAt).toBe(apiData.createdAt);
      expect(encoded.data.updatedAt).toBe(apiData.updatedAt);

      expect(encoded.data.question).not.toBe(apiData.question);
      expect(encoded.data.choices[0].choice).not.toBe(
        apiData.choices[0].choice,
      );

      const decoded = DataTransformer.decodeFromAPI(encoded.data);

      expect(decoded.question).toBe(apiData.question);
      expect(decoded.choices[0].choice).toBe(apiData.choices[0].choice);
    });
  });

  describe("Mixed Content Types", () => {
    it("should handle questions with mixed text, HTML, and markdown", () => {
      const question = {
        question: `<div>
  <h2>GitHub Repository Setup</h2>
  <p>Complete the following tasks:</p>
  <ol>
    <li>Create a <code>.github/ISSUE_TEMPLATE</code> folder</li>
    <li>Add a <strong>user-story.md</strong> file</li>
    <li>Include the template: <em>"As a [user]... I need [feature]... So that [benefit]..."</em></li>
  </ol>
  <blockquote>
    <p>💡 Tip: Use GitHub's template syntax for best results</p>
  </blockquote>
</div>`,
        choices: [
          {
            choice: "I understand and will complete all tasks ✓",
            feedback:
              "<p>Great! Make sure to follow the <a href='https://docs.github.com'>GitHub documentation</a> for best practices.</p>",
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(question);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.question).toBe(question.question);
      expect(decoded.question).toContain("GitHub Repository Setup");
      expect(decoded.question).toContain(".github/ISSUE_TEMPLATE");
      expect(decoded.choices[0].choice).toContain("✓");
      expect(decoded.choices[0].feedback).toContain("https://docs.github.com");
    });
  });

  describe("Edge Cases in Production Data", () => {
    it("should handle empty feedback gracefully", () => {
      const question = {
        choices: [
          { choice: "Option A", feedback: "" },
          { choice: "Option B", feedback: null },
          {
            choice: "Option C",
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(question);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.choices[0].feedback).toBe("");
      expect(decoded.choices[1].feedback).toBeNull();
      expect(decoded.choices[2].feedback).toBeUndefined();
    });

    it("should handle questions without choices", () => {
      const question = {
        id: 1,
        question: "<p>Free text question: Explain your approach</p>",
        type: "FREE_TEXT",
      };

      const encoded = DataTransformer.encodeForDatabase(question);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.question).toBe(question.question);
      expect(decoded.choices).toBeUndefined();
    });

    it("should handle rubrics without criteria", () => {
      const scoring = {
        rubrics: [
          {
            rubricQuestion: "Overall impression?",
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(scoring);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.rubrics[0].rubricQuestion).toBe(
        scoring.rubrics[0].rubricQuestion,
      );
      expect(decoded.rubrics[0].criteria).toBeUndefined();
    });
  });

  describe("Regression Tests for Bug Fixes", () => {
    it("should NOT encode generic 'rubricQuestion' at wrong level", () => {
      const data = {
        rubricQuestion: "Top-level field (should NOT be encoded)",
        questions: [
          {
            rubricQuestion: "Question-level field (should NOT be encoded)",
            scoring: {
              rubrics: [
                {
                  rubricQuestion: "Rubric field (SHOULD be encoded)",
                },
              ],
            },
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(data);

      expect(encoded.data.rubricQuestion).toBe(data.rubricQuestion);

      expect(encoded.data.questions[0].rubricQuestion).toBe(
        data.questions[0].rubricQuestion,
      );

      expect(
        encoded.data.questions[0].scoring.rubrics[0].rubricQuestion,
      ).not.toBe(data.questions[0].scoring.rubrics[0].rubricQuestion);

      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.rubricQuestion).toBe(data.rubricQuestion);
      expect(decoded.questions[0].rubricQuestion).toBe(
        data.questions[0].rubricQuestion,
      );
      expect(decoded.questions[0].scoring.rubrics[0].rubricQuestion).toBe(
        data.questions[0].scoring.rubrics[0].rubricQuestion,
      );
    });

    it("should NOT use BASE64_SEGMENT_REGEX to extract from mixed content", () => {
      const data = {
        content:
          "This is plain text that might have RGlk which looks like base64 but isn't",
      };

      const decoded = DataTransformer.decodeFromDatabase(data);

      expect(decoded.content).toBe(data.content);
    });
  });
});
