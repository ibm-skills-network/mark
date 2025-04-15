/* eslint-disable */
import {
  useAssignmentDetails,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import { useEffect, useState } from "react";
import { shallow } from "zustand/shallow";

type ContextMessage = {
  id: string;
  role: "system";
  content: string;
};

/**
 * A hook that provides comprehensive assignment context for the Mark chatbot when in learner mode
 */
export const useLearnerContext = () => {
  const {
    questions,
    activeQuestionNumber,
    activeAttemptId,
    showSubmissionFeedback,
    totalPointsEarned,
    totalPointsPossible,
    expiresAt,
  } = useLearnerStore(
    (state) => ({
      questions: state.questions,
      activeQuestionNumber: state.activeQuestionNumber,
      activeAttemptId: state.activeAttemptId,
      showSubmissionFeedback: state.showSubmissionFeedback,
      totalPointsEarned: state.totalPointsEarned,
      totalPointsPossible: state.totalPointsPossible,
      expiresAt: state.expiresAt,
    }),
    shallow
  );

  const { assignmentDetails, grade } = useAssignmentDetails(
    (state) => ({
      assignmentDetails: state.assignmentDetails,
      grade: state.grade,
    }),
    shallow
  );

  // Get attempts information from the overview store
  const { listOfAttempts, assignmentId, assignmentName } =
    useLearnerOverviewStore(
      (state) => ({
        listOfAttempts: state.listOfAttempts,
        assignmentId: state.assignmentId,
        assignmentName: state.assignmentName,
      }),
      shallow
    );

  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [assignmentMeta, setAssignmentMeta] = useState<{
    name?: string;
    type?: string;
    passingGrade?: number;
    numAttempts?: number;
    attemptsRemaining?: number;
  } | null>(null);

  // Determine if we're in graded or practice mode
  const isGradedAssignment = assignmentDetails?.graded === true;

  // Determine if we're in feedback view mode
  const isFeedbackMode = showSubmissionFeedback === true;

  // Find current attempt info
  const currentAttempt = listOfAttempts.find(
    (attempt) => attempt.id === activeAttemptId
  );

  // Calculate attempts remaining
  const calculateAttemptsRemaining = (): number => {
    if (
      !assignmentDetails ||
      !assignmentDetails.numAttempts ||
      assignmentDetails.numAttempts < 0
    ) {
      return -1; // Unlimited attempts
    }

    const usedAttempts = listOfAttempts.length;
    return Math.max(0, assignmentDetails.numAttempts - usedAttempts);
  };

  // Update current question when active question changes
  useEffect(() => {
    if (questions && activeQuestionNumber) {
      const questionIndex = activeQuestionNumber - 1;

      if (questions[questionIndex]) {
        setCurrentQuestion(questions[questionIndex]);
      } else if (questions.length > 0) {
        // Fallback to first question if index is out of bounds
        setCurrentQuestion(questions[0]);
      }
    }
  }, [questions, activeQuestionNumber]);

  // Update assignment metadata
  useEffect(() => {
    if (assignmentDetails) {
      setAssignmentMeta({
        name: assignmentDetails.name,
        type: assignmentDetails.graded ? "graded" : "practice",
        passingGrade: assignmentDetails.passingGrade,
        numAttempts: assignmentDetails.numAttempts,
        attemptsRemaining: calculateAttemptsRemaining(),
      });
    }
  }, [assignmentDetails, listOfAttempts]);

  // Generate a comprehensive context message for the current state
  const getContextMessage = async (): Promise<ContextMessage> => {
    let contextContent = "MARK ASSISTANT CONTEXT:\n\n";

    // Add detailed assignment info
    contextContent += `Assignment: ${
      assignmentDetails?.name || assignmentName || "Current assignment"
    }\n`;
    contextContent += `Assignment ID: ${
      assignmentId || assignmentDetails?.id || "Unknown"
    }\n`;
    contextContent += `Type: ${
      isGradedAssignment ? "Graded" : "Practice"
    } assignment\n`;
    contextContent += `Status: ${
      isFeedbackMode ? "Feedback Review" : "In Progress"
    }\n`;

    // Add attempt information
    contextContent += `Current Attempt ID: ${activeAttemptId || "N/A"}\n`;
    if (assignmentDetails?.numAttempts && assignmentDetails.numAttempts > 0) {
      contextContent += `Attempts Allowed: ${assignmentDetails.numAttempts}\n`;
      contextContent += `Attempts Remaining: ${calculateAttemptsRemaining()}\n`;
    } else {
      contextContent += "Attempts Allowed: Unlimited\n";
    }

    // Add time information if relevant
    if (expiresAt) {
      const expiresAtDate = new Date(expiresAt);
      const now = new Date();
      const timeRemaining = Math.max(
        0,
        Math.floor((expiresAtDate.getTime() - now.getTime()) / 60000)
      );

      contextContent += `Time Remaining: Approximately ${timeRemaining} minutes\n`;
    }

    contextContent += "\n";

    if (isFeedbackMode) {
      // FEEDBACK MODE
      contextContent += "MODE: FEEDBACK ANALYSIS\n";
      contextContent += `Overall Grade: ${
        grade !== null ? grade : totalPointsEarned
      }/${totalPointsPossible} points\n`;
      contextContent += `Passing Grade: ${
        assignmentDetails?.passingGrade || 50
      }%\n`;

      // Check if student has passed
      const percentage =
        grade !== null
          ? (grade / (totalPointsPossible || 100)) * 100
          : (totalPointsEarned / (totalPointsPossible || 100)) * 100;
      const passed = percentage >= (assignmentDetails?.passingGrade || 50);

      contextContent += `Student Status: ${
        passed ? "PASSED" : "NOT PASSED"
      }\n\n`;

      contextContent +=
        "The learner is reviewing their feedback. You can help explain assessment results, clarify rubric items, and suggest improvements for future assignments.\n\n";

      // Add feedback summary
      if (questions && questions.length > 0) {
        contextContent += "FEEDBACK SUMMARY:\n";

        questions.forEach((q) => {
          if (!q) return;

          const questionPoints = q.totalPoints || 0;
          const earnedPoints =
            q.questionResponses?.reduce(
              (acc: number, response: any) =>
                acc + (response.pointsEarned || 0),
              0
            ) || 0;

          contextContent += `Question ${q.id}: ${earnedPoints}/${questionPoints} points\n`;
          contextContent += `Type: ${q.type}\n`;
          contextContent += `Question: ${q.question}\n`;

          // Add learner response
          if (q.learnerTextResponse) {
            contextContent += `Learner's text response: ${q.learnerTextResponse.replace(
              /<[^>]*>/g,
              ""
            )}\n`;
          }
          if (q.learnerChoices && q.learnerChoices.length > 0) {
            contextContent += `Learner's selected choices: ${q.learnerChoices.join(
              ", "
            )}\n`;
          }
          if (q.learnerAnswerChoice !== undefined) {
            contextContent += `Learner's answer: ${
              q.learnerAnswerChoice ? "True" : "False"
            }\n`;
          }

          // Add feedback if available
          if (q.questionResponses && q.questionResponses.length > 0) {
            contextContent += "Feedback:\n";
            q.questionResponses.forEach((response: any) => {
              if (response.feedback) {
                contextContent += `- ${response.feedback}\n`;
              }
            });
          }

          contextContent += "\n";
        });
      }

      // Add regrading instructions
      contextContent += "REGRADING INFORMATION:\n";
      contextContent +=
        "- The learner can request regrading if they believe their assessment was scored incorrectly\n";
      contextContent +=
        "- You can help create a regrading request using the requestRegrading tool\n";
      contextContent +=
        "- Clearly explain the regrading process to the learner\n\n";
    } else {
      // IN-PROGRESS MODE
      contextContent += "MODE: ASSIGNMENT ASSISTANCE\n";

      if (isGradedAssignment) {
        contextContent += "This is a GRADED assignment. You should:\n";
        contextContent +=
          "- Only provide general guidance, NOT specific answers\n";
        contextContent += "- Focus on clarifying concepts and requirements\n";
        contextContent +=
          "- Encourage critical thinking rather than giving solutions\n";
        contextContent +=
          "- Avoid directly answering questions in a way that would undermine assessment\n";
      } else {
        contextContent += "This is a PRACTICE assignment. You can:\n";
        contextContent += "- Provide detailed explanations and hints\n";
        contextContent += "- Guide the learner step-by-step through concepts\n";
        contextContent += "- Suggest approaches to solve problems\n";
        contextContent += "- Offer constructive feedback on their work\n";
      }

      // Add current question details if available
      if (currentQuestion) {
        contextContent += "\nCURRENT QUESTION:\n";
        contextContent += `Question ID: ${currentQuestion.id}\n`;
        contextContent += `Question Type: ${currentQuestion.type}\n`;
        contextContent += `Question Text: ${currentQuestion.question}\n`;
        contextContent += `Points: ${currentQuestion.totalPoints || 10}\n`;

        // Add choices for multiple choice questions
        if (currentQuestion.choices && Array.isArray(currentQuestion.choices)) {
          contextContent += "Options:\n";
          currentQuestion.choices.forEach((choice: any, index: number) => {
            contextContent += `  ${index}. ${choice.text || choice.choice}\n`;
          });
        }

        // Add current learner response if any
        contextContent += "\nLearner's current response:\n";

        if (currentQuestion.learnerTextResponse) {
          contextContent += `Text Response: ${currentQuestion.learnerTextResponse.replace(
            /<[^>]*>/g,
            ""
          )}\n`;
        }

        if (
          currentQuestion.learnerChoices &&
          currentQuestion.learnerChoices.length > 0
        ) {
          contextContent += `Selected Choices: ${currentQuestion.learnerChoices.join(
            ", "
          )}\n`;
        }

        if (currentQuestion.learnerAnswerChoice !== undefined) {
          contextContent += `Answer: ${
            currentQuestion.learnerAnswerChoice ? "True" : "False"
          }\n`;
        }

        if (
          currentQuestion.learnerFileResponse &&
          currentQuestion.learnerFileResponse.length > 0
        ) {
          contextContent += `Uploaded Files: ${currentQuestion.learnerFileResponse
            .map((f: any) => f.filename)
            .join(", ")}\n`;
        }
      }
    }

    // Add issue reporting information
    contextContent += "\nISSUE REPORTING:\n";
    contextContent +=
      "- The learner can report technical issues, content problems, or grading concerns\n";
    contextContent +=
      "- You can help create a report using the reportIssue tool\n";
    contextContent +=
      "- Make sure to collect specific details about the issue\n\n";

    // Add behavioral guidelines
    contextContent += "REQUIRED BEHAVIOR:\n";
    contextContent += "1. Answer ONLY questions related to this assignment\n";
    contextContent +=
      "2. If the learner asks about unrelated topics, politely redirect them to the assignment\n";
    contextContent +=
      "3. Be encouraging, supportive, and clear in your explanations\n";
    contextContent += `4. For ${
      isGradedAssignment ? "graded" : "practice"
    } assignments, ${
      isGradedAssignment
        ? "provide guidance without giving direct answers"
        : "help the learner understand concepts and improve their work"
    }\n`;
    contextContent +=
      "5. Take regrade requests and issue reports seriously - these are important tools for learners\n";
    contextContent +=
      "6. When using tools, clearly explain to the learner what you're doing and what will happen next\n";

    return {
      id: `system-context-${Date.now()}`,
      role: "system",
      content: contextContent,
    };
  };

  // Get information about the current question
  const getCurrentQuestionInfo = () => {
    if (!currentQuestion) return null;

    return {
      id: currentQuestion.id,
      type: currentQuestion.type,
      question: currentQuestion.question,
      points: currentQuestion.totalPoints,
      hasResponse: Boolean(
        currentQuestion.learnerTextResponse ||
          (currentQuestion.learnerChoices &&
            currentQuestion.learnerChoices.length > 0) ||
          currentQuestion.learnerAnswerChoice !== undefined ||
          (currentQuestion.learnerFileResponse &&
            currentQuestion.learnerFileResponse.length > 0)
      ),
    };
  };

  return {
    getContextMessage,
    isGradedAssignment,
    isFeedbackMode,
    currentQuestion,
    getCurrentQuestionInfo,
    assignmentMeta,
    questions,
    currentAttempt,
    activeAttemptId,
    assignmentId: assignmentId || assignmentDetails?.id,
    attemptsRemaining: calculateAttemptsRemaining(),
  };
};
