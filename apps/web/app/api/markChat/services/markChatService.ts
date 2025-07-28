/* eslint-disable */

import { executeAuthorStoreOperation } from "@/app/chatbot/store/authorStoreUtil";
import { searchKnowledgeBase } from "@/app/chatbot/knowledgebase";
import { ReportingService } from "./reportingService";
import { IssueSeverity } from "@/config/types";
import { getBaseApiPath } from "@/config/constants";

/**
 * Get or create a chat session for today
 */
export async function getOrCreateTodayChat(
  userId: string,
  assignmentId?: number,
): Promise<any> {
  try {
    const url = `${getBaseApiPath("v1")}/chats/today`;

    const userSessionHeader = getUserSessionHeader();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-session": userSessionHeader || "",
      },
      body: JSON.stringify({
        userId,
        assignmentId,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get or create chat");
    }

    return await res.json();
  } catch (err) {
    throw err;
  }
}

/**
 * Add a message to a chat
 */
export async function addMessageToChat(
  chatId: string,
  role: "USER" | "ASSISTANT" | "SYSTEM",
  content: string,
  toolCalls?: any,
): Promise<any> {
  try {
    const url = `${getBaseApiPath("v1")}/chats/${chatId}/messages`;

    const userSessionHeader = getUserSessionHeader();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-session": userSessionHeader || "",
      },
      body: JSON.stringify({
        role,
        content,
        toolCalls,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to add message to chat");
    }

    return await res.json();
  } catch (err) {
    throw err;
  }
}

function getUserSessionHeader() {
  try {
    if (typeof window !== "undefined") {
      const sessionStr = localStorage.getItem("userSession");
      if (sessionStr) return sessionStr;

      const cookies = document.cookie.split(";");
      const userSessionCookie = cookies.find((c) =>
        c.trim().startsWith("userSession="),
      );
      if (userSessionCookie) {
        return userSessionCookie.split("=")[1];
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}
export class MarkChatService {
  static async reportIssue(
    issueType: string,
    description: string,
    details: {
      assignmentId?: number;
      attemptId?: number;
      userRole?: "author" | "learner" | "system";
      severity?: IssueSeverity;
      category?: string;
      [key: string]: any;
    } = {},
    cookieHeader?: string,
  ): Promise<string> {
    try {
      const title = `[${details.userRole?.toUpperCase() || "USER"}] ${issueType.charAt(0).toUpperCase() + issueType.slice(1)} Issue Report`;

      const result = await ReportingService.reportIssue(
        title,
        description,
        {
          issueType,
          assignmentId: details.assignmentId,
          attemptId: details.attemptId,
          userRole: details.userRole,
          severity: details.severity || determineIssueSeverity(issueType),
          category: details.category || "Chat Report",
          ...details,
        },
        cookieHeader,
      );

      return (
        result.content ||
        `Thank you for your report. Our team will review it shortly.`
      );
    } catch (error) {
      return `There was an error submitting your issue report. Please try again later. (Error: ${error.message})`;
    }
  }

  static async executeAuthorAction(action: string, params: any): Promise<any> {
    switch (action) {
      case "createQuestion":
        return await executeAuthorStoreOperation(
          "createQuestion",
          params.questionType,
          params.questionText,
          params.totalPoints || 10,
          params.options || [],
        );

      case "modifyQuestion":
        return await executeAuthorStoreOperation(
          "modifyQuestion",
          params.questionId,
          params.questionText,
          params.totalPoints,
          params.questionType,
        );

      case "deleteQuestion":
        return await executeAuthorStoreOperation(
          "deleteQuestion",
          params.questionId,
        );

      case "addRubric":
        return await executeAuthorStoreOperation(
          "addRubric",
          params.questionId,
          params.rubricQuestion,
          params.criteria,
        );

      case "generateQuestionVariant":
        return await executeAuthorStoreOperation(
          "generateQuestionVariant",
          params.questionId,
          params.variantType || "REWORDED",
        );

      case "generateQuestionsFromObjectives":
        return await executeAuthorStoreOperation(
          "generateQuestionsFromObjectives",
          params.learningObjectives,
          params.questionTypes,
          params.count || 5,
        );

      default:
        throw new Error(`Unknown author action: ${action}`);
    }
  }

  static generateSuggestions(
    userRole: "author" | "learner",
    context: any,
  ): string[] {
    if (userRole === "author") {
      const focusedQuestionId = context.focusedQuestionId;
      const questionType = focusedQuestionId
        ? context.getCurrentQuestionInfo()?.type
        : null;

      if (focusedQuestionId) {
        if (
          questionType === "MULTIPLE_CORRECT" ||
          questionType === "SINGLE_CORRECT"
        ) {
          return [
            "Improve this multiple choice question",
            "Add more answer options",
            "Generate a variant of this question",
            "Make the distractors more challenging",
            "Fix the scoring for this question",
          ];
        } else if (questionType === "TEXT") {
          return [
            "Create a rubric for this question",
            "Improve the question prompt",
            "Add specific evaluation criteria",
            "Suggest sample answer for this question",
            "Set appropriate word count limits",
          ];
        } else if (questionType === "TRUE_FALSE") {
          return [
            "Create variations of this true/false question",
            "Convert to multiple choice format",
            "Add explanation for the correct answer",
            "Make the statement more nuanced",
            "Create a related question pair",
          ];
        }

        return [
          "Improve this question",
          "Create a variant of this question",
          "Add a detailed rubric",
          "Clarify the instructions",
          "Adjust the scoring",
        ];
      }

      return [
        "Generate multiple-choice questions about...",
        "Create a mix of question types for...",
        "Design a text response question about...",
        "Add learning objectives for this assignment",
        "Generate questions based on these learning outcomes...",
      ];
    } else {
      if (context.isFeedbackMode) {
        return [
          "Explain why I lost points on this question",
          "Help me understand this feedback",
          "How can I improve my answer next time?",
          "Is there a specific concept I'm missing?",
          "Can you explain why this answer choice was incorrect?",
        ];
      }

      if (context.isGradedAssignment) {
        return [
          "What's the main focus of this question?",
          "Can you clarify what this question is asking?",
          "What concepts should I review for this question?",
          "Help me understand what's required here",
          "What approach should I take for this type of question?",
        ];
      } else {
        return [
          "Can you give me a hint for this problem?",
          "What concepts does this question test?",
          "I'm stuck on this part, can you help?",
          "How should I approach this question?",
          "Explain the key points I should address",
        ];
      }
    }
  }

  static async searchKnowledgeBase(query: string): Promise<any> {
    return await searchKnowledgeBase(query);
  }

  static generateFeedbackResponse(
    questionData: any,
    feedbackData: any,
  ): string {
    const { question, type, pointsEarned, totalPoints } = questionData;

    let response = `## Feedback for "${question}"\n\n`;
    response += `**Score:** ${pointsEarned}/${totalPoints} points\n\n`;

    if (type === "MULTIPLE_CORRECT" || type === "SINGLE_CORRECT") {
      response += "### Your Answer Choices:\n";
      feedbackData.choices.forEach((choice: any) => {
        response += `- ${choice.text} ${choice.isCorrect ? "✓" : "✗"}\n`;
        if (choice.feedback) {
          response += `  *${choice.feedback}*\n`;
        }
      });
    } else if (type === "TEXT") {
      response += "### Feedback on Your Response:\n";
      feedbackData.criteria.forEach((criterion: any) => {
        response += `- **${criterion.description}**: ${criterion.earned}/${criterion.points} points\n`;
        if (criterion.feedback) {
          response += `  *${criterion.feedback}*\n`;
        }
      });

      response += "\n### Suggestions for Improvement:\n";
      response +=
        feedbackData.suggestions ||
        "Focus on addressing all aspects of the question and providing complete explanations.";
    }

    return response;
  }
}
/**
 * Determine issue severity based on issue type
 */
function determineIssueSeverity(issueType: string): IssueSeverity {
  issueType = issueType.toLowerCase();

  if (
    issueType.includes("critical") ||
    issueType.includes("severe") ||
    issueType.includes("urgent")
  ) {
    return "critical";
  }

  if (
    issueType.includes("bug") ||
    issueType.includes("error") ||
    issueType.includes("technical")
  ) {
    return "error";
  }

  if (
    issueType.includes("grading") ||
    issueType.includes("warning") ||
    issueType.includes("concern")
  ) {
    return "warning";
  }

  return "info";
}
