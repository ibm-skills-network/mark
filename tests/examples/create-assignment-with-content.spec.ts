import { test } from "@playwright/test";
import {
  createApiContext,
  createAssignment,
  addContentToAssignment,
} from "../helpers/assignment-helpers";

/**
 * This is an example test showing how to create a complete assignment
 * with questions and configuration using API calls.
 *
 * NOTE: This test creates real data and may take longer to run.
 * Consider using this pattern in a setup fixture or beforeAll hook
 * for tests that need a fully populated assignment.
 */
test.describe("Example: Create Assignment with Content", () => {
  test("create a complete assignment via API", async () => {
    const apiContext = await createApiContext();

    try {
      // Step 1: Create an empty assignment
      const assignment = await createAssignment(apiContext, {
        name: "Complete Test Assignment",
        type: "AI_GRADED",
      });

      console.log(`Created assignment with ID: ${assignment.id}`);

      // Step 2: Add content to the assignment
      await addContentToAssignment(apiContext, assignment.id, {
        assignment: {
          name: "Complete Test Assignment",
          introduction:
            "This assignment tests your understanding of key concepts.",
          instructions:
            "Please answer all questions to the best of your ability. You have 3 attempts.",
        },
        config: {
          numAttempts: 3,
          attemptsBeforeCoolDown: 3,
          retakeAttemptCoolDownMinutes: 0,
          passingGrade: 60,
          displayOrder: "ORDERED", // or "RANDOM"
          graded: true,
          questionVariationNumber: 1,
          questionDisplay: "ONE_PAGE", // or "ONE_QUESTION_PER_PAGE"
          showQuestions: true,
          showSubmissionFeedback: true,
          showAssignmentScore: true,
          showQuestionScore: true,
          correctAnswerVisibility: "AFTER_DUE_DATE", // or "AFTER_SUBMISSION", "NEVER"
          numberOfQuestionsPerAttempt: null, // null for all questions
          timeEstimateMinutes: 30,
          allotedTimeMinutes: 45,
          attemptsPerTimeRange: null,
          attemptsTimeRangeHours: null,
        },
        feedbackConfig: {
          verbosityLevel: "detailed",
          showSubmissionFeedback: true,
          showQuestionScore: true,
          showAssignmentScore: true,
          showQuestions: true,
        },
        gradingCriteria:
          "Answers will be graded based on correctness and completeness.",
        questions: [
          {
            type: "SINGLE_CORRECT",
            question: "What is the capital of France?",
            responseType: "OTHER",
            totalPoints: 10,
            maxWords: null,
            maxCharacters: null,
            randomizedChoices: false,
            choices: [
              {
                id: 1,
                choice: "Paris",
                isCorrect: true,
                points: 10,
                feedback: "Correct! Paris is the capital of France.",
              },
              {
                id: 2,
                choice: "London",
                isCorrect: false,
                points: 0,
                feedback: "London is the capital of the United Kingdom.",
              },
              {
                id: 3,
                choice: "Berlin",
                isCorrect: false,
                points: 0,
                feedback: "Berlin is the capital of Germany.",
              },
              {
                id: 4,
                choice: "Madrid",
                isCorrect: false,
                points: 0,
                feedback: "Madrid is the capital of Spain.",
              },
            ],
            scoring: {
              type: "AUTOMATIC",
              showSubQuestionsToLearner: false,
              showPoints: true,
              showRubricsToLearner: false,
              rubrics: [],
            },
          },
          {
            type: "TEXT",
            question:
              "Explain the concept of object-oriented programming in your own words.",
            responseType: "ESSAY",
            totalPoints: 20,
            maxWords: 200,
            maxCharacters: 1000,
            randomizedChoices: null,
            choices: [],
            scoring: {
              type: "AI_GRADED",
              showSubQuestionsToLearner: true,
              showPoints: true,
              showRubricsToLearner: true,
              rubrics: [
                {
                  rubricQuestion:
                    "Does the response explain the key concepts of OOP?",
                  criteria: [
                    {
                      id: 1,
                      description: "Mentions encapsulation",
                      points: 5,
                    },
                    {
                      id: 2,
                      description: "Mentions inheritance",
                      points: 5,
                    },
                    {
                      id: 3,
                      description: "Mentions polymorphism",
                      points: 5,
                    },
                    {
                      id: 4,
                      description: "Provides clear explanation",
                      points: 5,
                    },
                  ],
                },
              ],
            },
          },
        ],
      });

      console.log(`Added content to assignment ${assignment.id}`);

      // Now you can use this assignment in your tests
      // For example, navigate to it:
      // await page.goto(`/author/${assignment.id}`);
      // or
      // await page.goto(`/learner/${assignment.id}`);
    } finally {
      await apiContext.dispose();
    }
  });
});
