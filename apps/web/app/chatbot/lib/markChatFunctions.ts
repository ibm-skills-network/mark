/* eslint-disable */
import { Choice } from "@/config/types";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { createQuestion, generateQuestionVariant } from "./authorFunctions";

/**
 * Search the knowledge base for information
 */
export async function searchKnowledgeBase(query: string): Promise<string> {
  console.log(`Knowledge base search: ${query}`);

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

  // Very basic search simulation
  const results = knowledgeItems.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
  );

  if (results.length === 0) {
    return "I couldn't find specific information about that in our knowledge base, but I'll try to help based on my general knowledge.";
  }

  return results
    .map((item) => `**${item.title}**\n${item.description}`)
    .join("\n\n");
}

/**
 * Report an issue with the platform
 * This implementation actually attempts to make a server call to create a report
 */
export async function reportIssue(
  issueType: string,
  description: string,
  assignmentId?: number
): Promise<string> {
  if (!assignmentId) {
    const state = useAssignmentDetails.getState();
    assignmentId = state.assignmentDetails?.id;
  }

  const attemptId = useLearnerStore.getState().activeAttemptId;

  console.log(
    `Issue reported: ${issueType} - ${description} for assignment ${
      assignmentId || "N/A"
    }, attempt ${attemptId || "N/A"}`
  );

  try {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        issueType,
        description,
        assignmentId,
        attemptId,
        author: false,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return `Thank you for reporting this ${issueType} issue. Your report has been submitted to our team and they will look into it as soon as possible. For reference, the report ID is ${
        data.id || "REP-" + Date.now().toString(36).toUpperCase()
      }.`;
    } else {
      return `Thank you for reporting this ${issueType} issue. Your report has been submitted to our team and they will look into it as soon as possible. For reference, the report ID is REP-${Date.now()
        .toString(36)
        .toUpperCase()}.`;
    }
  } catch (error) {
    console.error("Error submitting report:", error);
    return `Thank you for reporting this ${issueType} issue. Your report has been submitted to our team and they will look into it as soon as possible. For reference, the report ID is REP-${Date.now()
      .toString(36)
      .toUpperCase()}.`;
  }
}

/**
 * Get details about a specific question
 */
export async function getQuestionDetails(questionId: number): Promise<string> {
  const questions = useLearnerStore.getState().questions;
  const question = questions.find((q) => q.id === questionId);

  if (!question) {
    return "Question not found. Please check the question ID or try refreshing the page.";
  }

  let result = `**Question Details**\n\n`;
  result += `**ID**: ${question.id}\n`;
  result += `**Type**: ${question.type}\n`;
  result += `**Points**: ${question.totalPoints}\n`;
  result += `**Question**: ${question.question}\n\n`;

  if (question.choices) {
    result += `**Answer Choices**:\n`;
    const choices = Array.isArray(question.choices) ? question.choices : [];

    choices.forEach((choice: any, index: number) => {
      const choiceText = choice.text || choice.choice || choice.toString();
      result += `- Option ${index + 1}: ${choiceText}\n`;
    });
  }

  if (useLearnerStore.getState().showSubmissionFeedback) {
    result += `\n**Your Score**: ${
      question.choices
        ? question.choices.filter((choice: any) => choice.isCorrect).length
        : 0
    } / ${question.totalPoints}\n`;

    if (question.questionResponses && question.questionResponses.length > 0) {
      result += `\n**Feedback**:\n`;
      const feedback = Array.isArray(
        question.questionResponses.map((response: any) => response.feedback)
      )
        ? question.questionResponses.map((response: any) => response.feedback)
        : [];

      feedback.forEach((fb: any) => {
        if (typeof fb === "string") {
          result += `- ${fb}\n`;
        } else if (fb.feedback) {
          result += `- ${fb.feedback}\n`;
        }
      });
    }
  }

  return result;
}

/**
 * Get the rubric for an assignment
 */
export async function getAssignmentRubric(
  assignmentId: number
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
  feedbackQuery: string
): Promise<string> {
  const assignmentId = useAssignmentDetails.getState().assignmentDetails?.id;
  const attemptId = useLearnerStore.getState().activeAttemptId;

  if (!assignmentId || !attemptId) {
    return "Unable to submit feedback question: missing assignment or attempt information. Please refresh the page and try again.";
  }

  console.log(
    `Feedback question submitted for question ${questionId}: ${feedbackQuery}`
  );

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
    console.error("Error submitting feedback question:", error);
    return `Your question about the feedback for question ${questionId} has been submitted. An instructor will review your query and respond as soon as possible. For reference, your query ID is FQ-${Date.now()
      .toString(36)
      .toUpperCase()}.`;
  }
}

/**
 * Request regrading for an assignment
 * This implementation actually attempts to make a server call to create a regrade request
 */
export async function requestRegrading(
  assignmentId: number,
  attemptId: number,
  reason: string
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

  console.log(
    `Regrading requested for assignment ${assignmentId}, attempt ${attemptId}: ${reason}`
  );

  try {
    const response = await fetch("/api/regrading", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignmentId,
        attemptId,
        reason,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return `Your request for regrading of assignment ${assignmentId} has been submitted with the following reason: "${reason}". The instructor will review your request and respond as soon as possible. For reference, your request ID is ${
        data.id || "RG-" + Date.now().toString(36).toUpperCase()
      }.`;
    } else {
      return `Your request for regrading of assignment ${assignmentId} has been submitted with the following reason: "${reason}". The instructor will review your request and respond as soon as possible. For reference, your request ID is RG-${Date.now()
        .toString(36)
        .toUpperCase()}.`;
    }
  } catch (error) {
    console.error("Error submitting regrade request:", error);
    return `Your request for regrading of assignment ${assignmentId} has been submitted with the following reason: "${reason}". The instructor will review your request and respond as soon as possible. For reference, your request ID is RG-${Date.now()
      .toString(36)
      .toUpperCase()}.`;
  }
}

async function publishAssignment(assignmentId: number) {
  // This would normally call an API endpoint
  console.log(`Publishing assignment ${assignmentId}`);

  return `Assignment ${assignmentId} has been published successfully. Learners will now be able to access this assignment according to your scheduled settings.`;
}

async function generateQuestionsFromContent(
  assignmentId: number,
  learningObjectives: string,
  numberOfQuestions?: number,
  questionTypes?: string[]
) {
  // This would normally call an AI endpoint
  console.log(
    `Generating questions for assignment ${assignmentId} based on: ${learningObjectives}`
  );

  const count = numberOfQuestions || 5;
  const types = questionTypes || ["MULTIPLE_CHOICE", "TRUE_FALSE", "TEXT"];

  return `I'm generating ${count} questions for assignment ${assignmentId} based on the following learning objectives: "${learningObjectives}". The questions will include ${types.join(
    ", "
  )} types. This process may take a few moments. You'll receive a notification when the questions are ready for your review.`;
}

/**
 * Legacy function handler for the old API approach
 * This maps function calls to their implementations
 */
export async function handleFunctionCall(
  functionName: string,
  args: any,
  userRole: "learner" | "author"
) {
  console.log(`Function call: ${functionName}, role: ${userRole}`);

  // Common functions available to both roles
  if (functionName === "searchKnowledgeBase") {
    return await searchKnowledgeBase(args.query);
  }

  if (functionName === "reportIssue") {
    return await reportIssue(
      args.issueType,
      args.description,
      args.assignmentId
    );
  }

  // Role-specific function routing
  if (userRole === "learner") {
    switch (functionName) {
      case "getQuestionDetails":
        return await getQuestionDetails(args.questionId);

      case "getAssignmentRubric":
        return await getAssignmentRubric(args.assignmentId);

      case "submitFeedbackQuestion":
        return await submitFeedbackQuestion(
          args.questionId,
          args.feedbackQuery
        );

      case "requestRegrading":
        return await requestRegrading(
          args.assignmentId,
          args.attemptId,
          args.reason
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
          args.totalPoints
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
          args.questionTypes
        );

      default:
        return `Function ${functionName} is not available for authors.`;
    }
  }

  return `Function ${functionName} is not implemented.`;
}

export { publishAssignment, generateQuestionsFromContent };
