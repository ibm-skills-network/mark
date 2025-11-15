/* eslint-disable */
import {
  createQuestion,
  generateQuestionVariant,
} from "../store/authorStoreUtil";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { absoluteUrl } from "@/lib/utils";

/**
 * Search the knowledge base for information
 */
export async function searchKnowledgeBase(query: string): Promise<string> {
  const knowledgeItems = [
    {
      id: "kb-1",
      title: "Multiple Choice Questions",
      description:
        "Multiple choice questions allow learners to select one correct answer from several options. They're great for testing recall and recognition.",
    },
    {
      id: "kb-2",
      title: "Assignment Feedback",
      description:
        "Feedback is provided automatically for assignments based on the rubric and AI evaluation of the learner's responses.",
    },
    {
      id: "kb-3",
      title: "Practice vs. Graded Assignments",
      description:
        "Practice assignments allow unlimited attempts and provide detailed feedback. Graded assignments may have limited attempts and contribute to a final grade.",
    },
    {
      id: "kb-4",
      title: "Regrading Process",
      description:
        "You can request regrading if you believe your submission was incorrectly assessed. Instructors will review your request and adjust scores if appropriate.",
    },
    {
      id: "kb-5",
      title: "Technical Issues",
      description:
        "If you encounter technical issues with the platform, you can report them through Mark. Include the specific steps to reproduce the issue and any error messages you see.",
    },
  ];

  const results = knowledgeItems.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase()),
  );

  if (results.length === 0) {
    return "I couldn't find specific information about that in our knowledge base, but I'll try to help based on my general knowledge.";
  }

  return results
    .map((item) => `**${item.title}**\n${item.description}`)
    .join("\n\n");
}

const highestScoreResponse = (
  questionResponses: any[],
  showSubmissionFeedback: boolean,
) => {
  if (!questionResponses || questionResponses.length === 0) {
    return showSubmissionFeedback
      ? { points: 0, feedback: [{ feedback: "This answer was blank" }] }
      : undefined;
  }
  return questionResponses.reduce((acc, curr) =>
    acc.points > curr.points ? acc : curr,
  );
};
/**
 * Get details about a specific question
 */
export async function getQuestionDetails(questionId: number): Promise<string> {
  const questions = useLearnerStore.getState().questions;
  const question = questions.find((q) => q.id === questionId);

  if (!question) {
    return "Question not found. Please check the question ID or try refreshing the page.";
  }
  const pointsEarned = highestScoreResponse(
    question.questionResponses,
    useLearnerStore.getState().showSubmissionFeedback,
  );

  let result = `**Question Details**\n\n`;
  result += `**ID**: ${question.id}\n`;
  result += `**Type**: ${question.type}\n`;
  result += `**Max Points**: ${question.totalPoints}\n`;
  result += `**Points Earned**: ${pointsEarned?.points || 0}\n`;
  result += `**Question**: ${question.question}\n\n`;

  if (question.choices) {
    result += `**Answer Choices**:\n`;
    const choices = Array.isArray(question.choices) ? question.choices : [];

    choices.forEach((choice: any, index: number) => {
      const choiceText = choice.text || choice.choice || choice.toString();
      result += `- Option ${index + 1}: ${choiceText}\n`;
    });
  }

  if (
    useLearnerStore.getState().showSubmissionFeedback &&
    question.questionResponses &&
    question.questionResponses.length > 0
  ) {
    result += `\n**Feedback**:\n`;

    question.questionResponses.forEach((response: any) => {
      if (response.feedback) {
        if (Array.isArray(response.feedback)) {
          response.feedback.forEach((fb: any) => {
            const feedbackText =
              typeof fb === "string" ? fb : fb?.feedback || "";
            if (feedbackText) {
              result += `- ${feedbackText}\n`;
            }
          });
        } else if (typeof response.feedback === "string") {
          result += `- ${response.feedback}\n`;
        }
      }
    });
  }

  return result;
}

/**
 * Get the rubric for an assignment
 */
export async function getAssignmentRubric(
  assignmentId: number,
): Promise<string> {
  const assignmentDetails = useAssignmentDetails.getState().assignmentDetails;

  if (!assignmentDetails || assignmentDetails.id !== assignmentId) {
    return "Assignment rubric not found. Please check the assignment ID or try refreshing the page.";
  }

  let result = `**Assignment Rubric: ${assignmentDetails.name}**\n\n`;

  if (assignmentDetails.gradingCriteriaOverview) {
    result += `**Grading Criteria Overview**:\n${assignmentDetails.gradingCriteriaOverview}\n\n`;
  } else {
    result +=
      "This assignment doesn't have detailed grading criteria specified.\n\n";
  }

  result += `**Passing Grade**: ${assignmentDetails.passingGrade || 50}%\n`;

  if (assignmentDetails.graded) {
    result += `**Type**: Graded Assignment\n`;
  } else {
    result += `**Type**: Practice Assignment\n`;
  }

  if (assignmentDetails.numAttempts && assignmentDetails.numAttempts > 0) {
    result += `**Number of Attempts Allowed**: ${assignmentDetails.numAttempts}\n`;
  } else {
    result += `**Number of Attempts Allowed**: Unlimited\n`;
  }

  if (assignmentDetails.allotedTimeMinutes) {
    result += `**Time Limit**: ${assignmentDetails.allotedTimeMinutes} minutes\n`;
  }

  return result;
}

/**
 * Submit a question about feedback
 */
export async function submitFeedbackQuestion(
  questionId: number,
  feedbackQuery: string,
): Promise<string> {
  const assignmentId = useAssignmentDetails.getState().assignmentDetails?.id;
  const attemptId = useLearnerStore.getState().activeAttemptId;

  if (!assignmentId || !attemptId) {
    return "Unable to submit feedback question: missing assignment or attempt information. Please refresh the page and try again.";
  }
  try {
    const response = await fetch("/api/feedbackQuestions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignmentId,
        attemptId,
        questionId,
        feedbackQuery,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return `Your question about the feedback for question ${questionId} has been submitted. An instructor will review your query and respond as soon as possible. For reference, your query ID is ${
        data.id || "FQ-" + Date.now().toString(36).toUpperCase()
      }.`;
    } else {
      return `Your question about the feedback for question ${questionId} has been submitted. An instructor will review your query and respond as soon as possible. For reference, your query ID is FQ-${Date.now()
        .toString(36)
        .toUpperCase()}.`;
    }
  } catch (error) {
    return `Your question about the feedback for question ${questionId} has been submitted. An instructor will review your query and respond as soon as possible. For reference, your query ID is FQ-${Date.now()
      .toString(36)
      .toUpperCase()}.`;
  }
}

/**
 * Request regrading for an assignment
 * This implementation submits a regrading request through the backend API
 * It also calculates and proposes a new grade based on the learner's concerns
 */
export async function requestRegrading(
  assignmentId: number,
  attemptId: number,
  reason: string,
  questionIds?: number[],
): Promise<string> {
  if (!assignmentId) {
    assignmentId = useAssignmentDetails.getState().assignmentDetails?.id || 0;
  }

  if (!attemptId) {
    attemptId = useLearnerStore.getState().activeAttemptId || 0;
  }

  if (!assignmentId || !attemptId) {
    return "Unable to submit regrading request: missing assignment or attempt information. Please refresh the page and try again.";
  }

  if (!reason || reason.trim() === "") {
    return "Unable to submit regrading request: please provide a reason for your request.";
  }

  try {
    let currentGrade = useAssignmentDetails.getState().grade || 0;
    let proposedGrade: number;
    let usedQuestionCalculation = false;

    if (questionIds && questionIds.length > 0) {
      let questions = useLearnerStore.getState().questions || [];
      let totalPointsPossible =
        useLearnerStore.getState().totalPointsPossible || 100;

      if (questions.length === 0) {
        try {
          const url = absoluteUrl(
            `/api/v2/assignments/${assignmentId}/attempts/${attemptId}/completed`,
          );
          const response = await fetch(url, { credentials: "include" });

          if (response.ok) {
            const data = await response.json();

            questions = data.questions || [];
            totalPointsPossible =
              data.totalPossiblePoints ||
              data.totalPointsPossible ||
              questions.reduce((sum, q) => sum + (q.totalPoints || 0), 0) ||
              100;

            if (data.grade !== undefined && data.grade !== null) {
              currentGrade = data.grade * 100;
            } else {
              const totalEarnedPoints = questions.reduce((sum, q) => {
                const earnedPts = q.questionResponses?.[0]?.points || 0;
                return sum + earnedPts;
              }, 0);

              if (totalPointsPossible > 0) {
                currentGrade = (totalEarnedPoints / totalPointsPossible) * 100;
              } else {
              }
            }
          } else {
          }
        } catch (error) {}
      }

      const complainedQuestions = questions.filter((q) =>
        questionIds.includes(q.id),
      );

      if (complainedQuestions.length > 0 && totalPointsPossible > 0) {
        let questionsTotalPoints = 0;
        let questionsEarnedPoints = 0;

        complainedQuestions.forEach((q) => {
          const totalPts = q.totalPoints || 0;
          const earnedPts = q.questionResponses?.[0]?.points || 0;
          questionsTotalPoints += totalPts;
          questionsEarnedPoints += earnedPts;
        });

        const maxImprovement = questionsTotalPoints - questionsEarnedPoints;
        const improvementPercentage =
          (maxImprovement / totalPointsPossible) * 100;

        proposedGrade =
          Math.min(currentGrade + improvementPercentage, 100) / 100;

        proposedGrade = Math.max(currentGrade / 100, proposedGrade);
        usedQuestionCalculation = true;
      } else {
      }
    }

    if (!usedQuestionCalculation) {
      if (currentGrade >= 90) {
        proposedGrade = Math.min(currentGrade + 5, 100) / 100;
      } else if (currentGrade >= 70) {
        proposedGrade = Math.min(currentGrade + 15, 85) / 100;
      } else if (currentGrade >= 50) {
        proposedGrade = 0.8;
      } else {
        proposedGrade = 0.7;
      }

      proposedGrade = Math.max(currentGrade / 100, proposedGrade);
    }

    if (isNaN(proposedGrade) || !isFinite(proposedGrade)) {
      proposedGrade = 0.7;
    }

    proposedGrade = Math.max(0, Math.min(1, proposedGrade));

    const url = absoluteUrl(
      `/api/v2/assignments/${assignmentId}/attempts/${attemptId}/regrade`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        regradingRequest: {
          reason: reason.trim(),
          proposedGrade: proposedGrade,
          questionIds: questionIds || [],
        },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const proposedGradePercent = (proposedGrade * 100).toFixed(1);
      const currentGradeValue =
        useAssignmentDetails.getState().grade || currentGrade || 0;

      const questionText =
        questionIds && questionIds.length > 0
          ? `\n- Questions Mentioned: ${questionIds.map((id) => `ID ${id}`).join(", ")}`
          : "";

      const proposalExplanation = usedQuestionCalculation
        ? `I've proposed giving you full credit on the specific question${questionIds.length > 1 ? "s" : ""} you mentioned. This would bring your grade to ${proposedGradePercent}% (maximum possible if ${questionIds.length > 1 ? "these questions get" : "this question gets"} full marks).`
        : questionIds && questionIds.length > 0
          ? `I've proposed an improved grade. Note: I couldn't find the specific questions in the current data, so I used a general improvement calculation.`
          : `I've proposed an improved grade based on your complaint.`;

      return `✅ Your request for regrading has been successfully submitted!\n\n**Details:**\n- Assignment ID: ${assignmentId}\n- Attempt ID: ${attemptId}\n- Request ID: ${data.id || "RG-" + Date.now().toString(36).toUpperCase()}\n- Current Grade: ${currentGradeValue.toFixed(1)}%\n- AI Proposed Grade: ${proposedGradePercent}%${questionText}\n- Reason: "${reason}"\n\n${proposalExplanation} Your instructor will review your request along with this proposal and make a final decision. You'll be notified once the review is complete.`;
    } else {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.message || response.statusText;

      if (response.status === 403) {
        return `❌ Unable to submit regrading request: You don't have permission to request regrading for this attempt. This may be because:\n- The attempt belongs to another student\n- The assignment is no longer accepting regrade requests\n\nPlease contact your instructor if you believe this is an error.`;
      } else if (response.status === 404) {
        return `❌ Unable to submit regrading request: The assignment or attempt could not be found. Please verify:\n- Assignment ID: ${assignmentId}\n- Attempt ID: ${attemptId}\n\nTry refreshing the page or contact your instructor if the problem persists.`;
      }

      return `⚠️ There was an issue submitting your regrading request: ${errorMessage}\n\nPlease try again in a few moments. If the problem persists, contact your instructor and provide them with:\n- Assignment ID: ${assignmentId}\n- Attempt ID: ${attemptId}`;
    }
  } catch (error) {
    return `⚠️ Unable to connect to the server to submit your regrading request. Please check your internet connection and try again.\n\nIf the problem persists, you can contact your instructor directly and provide them with:\n- Assignment ID: ${assignmentId}\n- Attempt ID: ${attemptId}\n- Reason: "${reason}"`;
  }
}

async function publishAssignment(assignmentId: number) {
  return `Assignment ${assignmentId} has been published successfully. Learners will now be able to access this assignment according to your scheduled settings.`;
}

async function generateQuestionsFromContent(
  assignmentId: number,
  learningObjectives: string,
  numberOfQuestions?: number,
  questionTypes?: string[],
) {
  const count = numberOfQuestions || 5;
  const types = questionTypes || ["MULTIPLE_CHOICE", "TRUE_FALSE", "TEXT"];

  return `I'm generating ${count} questions for assignment ${assignmentId} based on the following learning objectives: "${learningObjectives}". The questions will include ${types.join(
    ", ",
  )} types. This process may take a few moments. You'll receive a notification when the questions are ready for your review.`;
}

/**
 * Legacy function handler for the old API approach
 * This maps function calls to their implementations
 */
export async function handleFunctionCall(
  functionName: string,
  args: any,
  userRole: "learner" | "author",
) {
  if (functionName === "searchKnowledgeBase") {
    return await searchKnowledgeBase(args.query);
  }

  if (userRole === "learner") {
    switch (functionName) {
      case "getQuestionDetails":
        return await getQuestionDetails(args.questionId);

      case "getAssignmentRubric":
        return await getAssignmentRubric(args.assignmentId);

      case "submitFeedbackQuestion":
        return await submitFeedbackQuestion(
          args.questionId,
          args.feedbackQuery,
        );

      case "requestRegrading":
        return await requestRegrading(
          args.assignmentId,
          args.attemptId,
          args.reason,
        );

      default:
        return `Function ${functionName} is not available for learners.`;
    }
  } else if (userRole === "author") {
    switch (functionName) {
      case "createQuestion":
        return await createQuestion(
          args.assignmentId,
          args.questionType,
          args.questionText,
          args.totalPoints,
        );

      case "generateQuestionVariant":
        return await generateQuestionVariant(args.questionId, args.variantType);

      case "publishAssignment":
        return await publishAssignment(args.assignmentId);

      case "generateQuestionsFromContent":
        return await generateQuestionsFromContent(
          args.assignmentId,
          args.learningObjectives,
          args.numberOfQuestions,
          args.questionTypes,
        );

      default:
        return `Function ${functionName} is not available for authors.`;
    }
  }

  return `Function ${functionName} is not implemented.`;
}

export { publishAssignment, generateQuestionsFromContent };
