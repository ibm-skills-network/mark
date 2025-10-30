/* eslint-disable */
import { MarkChatService } from "../services/markChatService";
import {
  getAssignmentRubric,
  getQuestionDetails,
  requestRegrading,
  searchKnowledgeBase,
  submitFeedbackQuestion,
} from "@/app/chatbot/lib/markChatFunctions";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

function withErrorHandling(fn) {
  return async (...args) => {
    try {
      console.group(`Tool Execution: ${fn.name || "unknown"}`);
      const params = args[0] || {};
      const result = await fn(...args);
      console.groupEnd();

      if (!result || result === "" || result === undefined) {
        return STANDARD_ERROR_MESSAGE;
      }

      return result;
    } catch (error) {
      console.groupEnd();
      return `Error in ${fn.name || "function"}: ${error.message || STANDARD_ERROR_MESSAGE}`;
    }
  };
}

export function learnerTools(cookieHeader: string) {
  return {
    searchKnowledgeBase: {
      description:
        "Search the knowledge base for information about the platform or features",
      parameters: z.object({
        query: z
          .string()
          .describe("The search query to find relevant information"),
      }),
      execute: withErrorHandling(async ({ query }) => {
        return await searchKnowledgeBase(query);
      }),
    },
    reportIssue: {
      description:
        "Report a technical issue or bug with the platform. Extract the user's issue description and use it to prefill the form.",
      parameters: z.object({
        issueType: z
          .enum(["technical", "content", "grading", "other"])
          .describe("The type of issue being reported"),
        description: z
          .string()
          .describe(
            "Detailed description of the issue - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment where the issue was encountered (if applicable)",
          ),
        severity: z
          .enum(["info", "warning", "error", "critical"])
          .optional()
          .describe("The severity of the issue"),
      }),
      execute: async ({ issueType, description, assignmentId, severity }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "report",
            issueType,
            description,
            assignmentId,
            severity: severity || "info",
            userRole: "learner",
            category: "Learner Issue",
          },
        });
      },
    },
    provideFeedback: {
      description:
        "Provide general feedback about the learning experience or platform. Extract the user's feedback text and use it as the description to prefill the form.",
      parameters: z.object({
        feedbackType: z
          .enum(["general", "assignment", "grading", "experience"])
          .describe("The type of feedback being provided"),
        description: z
          .string()
          .describe(
            "Detailed feedback comments - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if feedback is assignment-specific)",
          ),
        rating: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe("Optional rating from 1-5 stars"),
      }),
      execute: async ({ feedbackType, description, assignmentId, rating }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "feedback",
            issueType: "FEEDBACK",
            description,
            assignmentId,
            rating,
            userRole: "learner",
            category: "Learner Feedback",
          },
        });
      },
    },
    submitSuggestion: {
      description:
        "Submit suggestions for improving the platform or assignments. Extract the user's suggestion text and use it as the description to prefill the form.",
      parameters: z.object({
        suggestionType: z
          .enum(["feature", "content", "ui", "general"])
          .describe("The type of suggestion being made"),
        description: z
          .string()
          .describe(
            "Detailed suggestion or improvement idea - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if suggestion is assignment-specific)",
          ),
      }),
      execute: async ({ suggestionType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "suggestion",
            issueType: "SUGGESTION",
            description,
            assignmentId,
            userRole: "learner",
            category: "Learner Suggestion",
          },
        });
      },
    },
    submitInquiry: {
      description:
        "Submit general questions or inquiries about the platform or assignments. Extract the user's question text and use it as the description to prefill the form.",
      parameters: z.object({
        inquiryType: z
          .enum(["general", "technical", "academic", "other"])
          .describe("The type of inquiry being made"),
        description: z
          .string()
          .describe(
            "The question or inquiry details - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if inquiry is assignment-specific)",
          ),
      }),
      execute: async ({ inquiryType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "inquiry",
            issueType: "OTHER",
            description,
            assignmentId,
            userRole: "learner",
            category: "Learner Inquiry",
          },
        });
      },
    },
    getQuestionDetails: {
      description:
        "Get detailed information about a specific question in the assignment",
      parameters: z.object({
        questionId: z
          .number()
          .describe("The ID of the question to retrieve details for"),
      }),
      execute: withErrorHandling(async ({ questionId }) => {
        return await getQuestionDetails(questionId);
      }),
    },
    getAssignmentRubric: {
      description: "Get the rubric or grading criteria for the assignment",
      parameters: z.object({
        assignmentId: z.number().describe("The ID of the assignment"),
      }),
      execute: withErrorHandling(async ({ assignmentId }) => {
        return await getAssignmentRubric(assignmentId);
      }),
    },
    submitFeedbackQuestion: {
      description:
        "Submit a question about feedback that requires instructor attention",
      parameters: z.object({
        questionId: z
          .number()
          .describe("The ID of the question being asked about"),
        feedbackQuery: z
          .string()
          .describe("The specific question or concern about the feedback"),
      }),
      execute: withErrorHandling(async ({ questionId, feedbackQuery }) => {
        return await submitFeedbackQuestion(questionId, feedbackQuery);
      }),
    },
    requestRegrading: {
      description: "Submit a formal request for regrading an assignment",
      parameters: z.object({
        assignmentId: z
          .number()
          .optional()
          .describe("The ID of the assignment to be regraded"),
        attemptId: z
          .number()
          .optional()
          .describe("The ID of the attempt to be regraded"),
        reason: z.string().describe("The reason for requesting regrading"),
      }),
      execute: withErrorHandling(
        async ({ assignmentId, attemptId, reason }) => {
          const result = await requestRegrading(
            assignmentId,
            attemptId,
            reason,
          );
          return result;
        },
      ),
    },
  };
}

export function authorTools(cookieHeader: string) {
  return {
    createQuestion: {
      description:
        "Create a new question for the assignment with complete specifications",
      parameters: z.object({
        questionType: z
          .enum([
            "TEXT",
            "SINGLE_CORRECT",
            "MULTIPLE_CORRECT",
            "TRUE_FALSE",
            "URL",
            "UPLOAD",
          ])
          .describe("The type of question to create"),
        questionText: z.string().describe("The text of the question"),
        totalPoints: z
          .number()
          .optional()
          .describe("The number of points the question is worth"),
        feedback: z.string().optional().describe("Feedback for the question"),
        options: z
          .array(
            z.object({
              text: z.string().describe("The text of the option"),
              isCorrect: z.boolean().describe("Whether this option is correct"),
              points: z.number().optional().describe("Points for this option"),
            }),
          )
          .optional()
          .describe("For multiple choice questions, the answer options"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "createQuestion",
          params,
        });
      },
    },
    modifyQuestion: {
      description: "Modify an existing question",
      parameters: z.object({
        questionId: z.number().describe("The ID of the question to modify"),
        questionText: z
          .string()
          .optional()
          .describe("The updated text of the question"),
        totalPoints: z
          .number()
          .optional()
          .describe("The updated number of points"),
        questionType: z
          .string()
          .optional()
          .describe("The updated type of the question"),
        feedback: z.string().optional().describe("Feedback for the question"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "modifyQuestion",
          params,
        });
      },
    },
    setQuestionChoices: {
      description: "Set the choices for a multiple choice question",
      parameters: z.object({
        questionId: z.number().describe("The ID of the question"),
        choices: z
          .array(
            z.object({
              text: z.string().describe("The text of the choice"),
              isCorrect: z.boolean().describe("Whether this choice is correct"),
              points: z.number().optional().describe("Points for this choice"),
              feedback: z
                .string()
                .optional()
                .describe("Feedback for this choice"),
            }),
          )
          .describe("The choices for the question"),
        variantId: z
          .number()
          .optional()
          .describe("The ID of the variant if applicable"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "setQuestionChoices",
          params,
        });
      },
    },
    addRubric: {
      description:
        "Add a scoring rubric to a question (REQUIRED for text response questions)",
      parameters: z.object({
        questionId: z.number().describe("The ID of the question"),
        rubricQuestion: z.string().describe("The text of the rubric question"),
        criteria: z
          .array(
            z.object({
              description: z.string().describe("Description of the criterion"),
              points: z.number().describe("Points for this criterion"),
            }),
          )
          .describe("The criteria for the rubric"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "addRubric",
          params,
        });
      },
    },
    generateQuestionVariant: {
      description: "Generate a variant of an existing question",
      parameters: z.object({
        questionId: z
          .number()
          .describe("The ID of the question to create a variant for"),
        variantType: z
          .enum(["REWORDED", "REPHRASED"])
          .describe("The type of variant to create"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "generateQuestionVariant",
          params,
        });
      },
    },
    deleteQuestion: {
      description: "Delete a question from the assignment",
      parameters: z.object({
        questionId: z.number().describe("The ID of the question to delete"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "deleteQuestion",
          params,
        });
      },
    },
    generateQuestionsFromObjectives: {
      description: "Generate questions based on learning objectives",
      parameters: z.object({
        learningObjectives: z
          .string()
          .describe("The learning objectives to generate questions from"),
        questionTypes: z
          .array(z.string())
          .optional()
          .describe("The types of questions to generate"),
        count: z
          .number()
          .optional()
          .describe("The number of questions to generate"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "generateQuestionsFromObjectives",
          params,
        });
      },
    },
    updateLearningObjectives: {
      description: "Update the learning objectives for the assignment",
      parameters: z.object({
        learningObjectives: z
          .string()
          .describe("The updated learning objectives"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "updateLearningObjectives",
          params,
        });
      },
    },
    setQuestionTitle: {
      description: "Set the title for a question",
      parameters: z.object({
        questionId: z.number().describe("The ID of the question"),
        title: z.string().describe("The title of the question"),
      }),
      execute: async (params) => {
        return JSON.stringify({
          clientExecution: true,
          function: "setQuestionTitle",
          params,
        });
      },
    },

    searchKnowledgeBase: {
      description:
        "Search the knowledge base for information about the platform or features",
      parameters: z.object({
        query: z
          .string()
          .describe("The search query to find relevant information"),
      }),
      execute: withErrorHandling(async ({ query }) => {
        return await searchKnowledgeBase(query);
      }),
    },
    reportIssue: {
      description:
        "Report a technical issue or bug with the platform. Extract the user's issue description and use it to prefill the form.",
      parameters: z.object({
        issueType: z
          .enum(["technical", "content", "grading", "other"])
          .describe("The type of issue being reported"),
        description: z
          .string()
          .describe(
            "Detailed description of the issue - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment where the issue was encountered (if applicable)",
          ),
        severity: z
          .enum(["info", "warning", "error", "critical"])
          .optional()
          .describe("The severity of the issue"),
      }),
      execute: async ({ issueType, description, assignmentId, severity }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            issueType,
            description,
            assignmentId,
            severity: severity || "info",
            userRole: "author",
            category: "Author Issue",
          },
        });
      },
    },
    provideFeedback: {
      description:
        "Provide general feedback about the teaching experience or platform. Extract the user's feedback text and use it as the description to prefill the form.",
      parameters: z.object({
        feedbackType: z
          .enum(["general", "assignment", "grading", "experience"])
          .describe("The type of feedback being provided"),
        description: z
          .string()
          .describe(
            "Detailed feedback comments - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if feedback is assignment-specific)",
          ),
        rating: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe("Optional rating from 1-5 stars"),
      }),
      execute: async ({ feedbackType, description, assignmentId, rating }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "feedback",
            issueType: "FEEDBACK",
            description,
            assignmentId,
            rating,
            userRole: "author",
            category: "Author Feedback",
          },
        });
      },
    },
    submitSuggestion: {
      description:
        "Submit suggestions for improving the platform or teaching tools. Extract the user's suggestion text and use it as the description to prefill the form.",
      parameters: z.object({
        suggestionType: z
          .enum(["feature", "content", "ui", "general"])
          .describe("The type of suggestion being made"),
        description: z
          .string()
          .describe(
            "Detailed suggestion or improvement idea - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if suggestion is assignment-specific)",
          ),
      }),
      execute: async ({ suggestionType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "suggestion",
            issueType: "SUGGESTION",
            description,
            assignmentId,
            userRole: "author",
            category: "Author Suggestion",
          },
        });
      },
    },
    submitInquiry: {
      description:
        "Submit general questions or inquiries about the platform or assignments. Extract the user's question text and use it as the description to prefill the form.",
      parameters: z.object({
        inquiryType: z
          .enum(["general", "technical", "academic", "other"])
          .describe("The type of inquiry being made"),
        description: z
          .string()
          .describe(
            "The question or inquiry details - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if inquiry is assignment-specific)",
          ),
      }),
      execute: async ({ inquiryType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "inquiry",
            issueType: "OTHER",
            description,
            assignmentId,
            userRole: "author",
            category: "Author Inquiry",
          },
        });
      },
    },
  };
}

function generateSystemPrompt(userRole, assignmentInfo) {
  const assignmentMode = assignmentInfo?.mode || "unknown";
  const isSubmitted = assignmentInfo?.submitted === true;
  const assignmentId = assignmentInfo?.assignmentId;

  const systemPrompts = {
    author: `You are Mark, an AI assistant for assignment authors on an educational platform. Your primary purpose is to help instructors create high-quality educational content through direct action.

CAPABILITIES:
- Create new questions of any type (multiple choice, text response, true/false, etc.)
- Modify existing questions by updating text, points, or type
- Set up answer choices for multiple choice questions
- Add and modify rubrics for assessment
- Generate question variants to provide diversity
- Delete questions when needed
- Generate questions based on learning objectives
- Provide instructional design advice
- Monitor assignment state and proactively offer help

PROACTIVE MONITORING:
1. Watch for context changes and offer relevant assistance
2. If you notice missing rubrics, incomplete questions, or errors, proactively offer to fix them
3. When a question is focused, analyze it and suggest improvements
4. If the assignment has no questions, guide the author through creating their first question
5. Monitor for common issues like:
   - Questions without rubrics (for text/essay questions)
   - Multiple choice questions without enough options
   - True/false questions that could be ambiguous
   - Missing point values or unclear instructions

QUESTION GENERATION BEST PRACTICES:
1. Always create complete questions with all required fields:
   - Clear, unambiguous question text
   - Appropriate point values (default 10 if not specified)
   - For text questions: ALWAYS include detailed rubrics with at least 3-4 criteria
   - For multiple choice: Include 4-5 options with clear correct/incorrect distinctions
   - For true/false: Ensure statements are factual and verifiable
2. Be interactive during generation:
   - Ask for clarification on learning objectives if vague
   - Suggest question types based on the content
   - Offer to create multiple related questions as a set
3. Quality checks:
   - Verify all generated questions have complete rubrics
   - Ensure point distributions make sense
   - Check for clarity and educational value

ACTION GUIDELINES:
1. Be proactive - monitor the context and offer help before being asked
2. When you see errors or issues, immediately offer solutions
3. For question creation, ALWAYS provide complete specifications including rubrics
4. Use multiple tool calls to ensure completeness (create question, then add rubric)
5. After any operation, verify the result and offer next steps
6. If something seems wrong, investigate and offer to fix it

TOOL USAGE:
- Use createQuestion for adding new questions (ALWAYS follow with addRubric for text questions)
- Use modifyQuestion for updating question content
- Use setQuestionChoices for multiple choice options
- Use addRubric for scoring criteria (MANDATORY for text response questions)
- Use generateQuestionVariant for creating variations
- Use deleteQuestion for removing questions
- Use generateQuestionsFromObjectives for AI-generated content
- Use updateLearningObjectives for curriculum planning
- Use reportIssue only for technical issues after exhausting troubleshooting options
- Use provideFeedback for sharing general feedback about teaching experience
- Use submitSuggestion for platform or teaching tool improvement ideas
- Use submitInquiry for general questions or inquiries

IMPORTANT: ${assignmentId ? `When calling tools that require assignmentId, always use ${assignmentId}` : "Assignment ID information is not available in the current context"}

RESPONSE STYLE:
- Be conversational and encouraging
- Provide visual feedback about what you're doing (use emojis sparingly but effectively)
- Show the current state of questions you're working on
- Celebrate successes and guide through challenges
- Always confirm what you've done and suggest logical next steps`,

    learner: `You are Mark, an AI tutor and assistant for learners on an educational platform. Your approach varies based on the assignment type and status.

CORE PRINCIPLE: You are an educator first, assistant second. Your goal is to help learners understand concepts deeply.

${
  assignmentMode === "practice"
    ? `PRACTICE ASSIGNMENT MODE - FULL TUTORING:
You are a comprehensive tutor who helps learners master concepts through detailed explanations.

TUTORING APPROACH:
1. Concept Explanation:
   - Start with the fundamental concept behind the question
   - Use analogies and real-world examples
   - Break down complex ideas into digestible parts
   - Connect new concepts to what they might already know

2. Problem-Solving Guidance:
   - Walk through the solution step-by-step
   - Explain WHY each step is important
   - Show alternative approaches when applicable
   - Highlight common mistakes and how to avoid them

3. Direct Answer Policy:
   - YES, provide direct answers in practice mode
   - BUT always explain the reasoning thoroughly
   - Show the complete solution process
   - Explain why other options are incorrect (for multiple choice)

4. Learning Reinforcement:
   - Ask follow-up questions to check understanding
   - Suggest related practice problems
   - Provide additional resources or examples
   - Encourage reflection on what was learned

EXAMPLE TUTORING FLOW:
"Let me help you understand this concept! 

First, let's talk about [core concept]. Think of it like [analogy]...

Now, for this specific question, here's how we approach it:
1. [Step 1 with explanation]
2. [Step 2 with explanation]
...

The answer is [direct answer] because [detailed reasoning].

Does this make sense? Would you like me to explain any part differently or try another example?"`
    : assignmentMode === "graded"
      ? `GRADED ASSIGNMENT MODE - GUIDANCE ONLY:
Assignment submission status: ${isSubmitted ? "SUBMITTED" : "NOT SUBMITTED"}

${
  !isSubmitted
    ? `STRICT RULES FOR UNSUBMITTED GRADED ASSIGNMENTS:
    
WHAT YOU CANNOT DO:
- ❌ NO direct answers or solutions
- ❌ NO step-by-step problem solving
- ❌ NO hints that would lead to the answer
- ❌ NO evaluation of their proposed solutions
- ❌ NO specific examples that parallel the question
- ❌ NO detailed concept explanations that reveal the approach

WHAT YOU CAN DO:
- ✅ Clarify what the question is asking (without interpreting it)
- ✅ Define general terms or vocabulary
- ✅ Point to course materials or textbook chapters
- ✅ Explain submission requirements or format
- ✅ Help with technical issues or platform navigation
- ✅ Provide general study tips

RESPONSE TEMPLATE:
"I understand you're working on a graded assignment. While I can't provide specific help with the solution, I can:
- Clarify any confusing wording in the question
- Point you to relevant course materials
- Help with technical issues

What aspect would you like clarification on?"`
    : `SUBMITTED GRADED ASSIGNMENTS - FULL EXPLANATION:
Now that you've submitted, I can help you understand everything!

- Provide detailed explanations of correct answers
- Explain why your approach worked or didn't
- Show alternative solutions
- Help you learn from any mistakes
- Prepare you for similar problems in the future`
}`
      : `UNKNOWN ASSIGNMENT MODE - CAUTIOUS APPROACH:
I'll provide general conceptual guidance while being careful not to give away specific answers.

- Focus on fundamental concepts
- Provide general problem-solving strategies
- Suggest reviewing course materials
- Avoid specific solutions or direct answers`
}

EMOTIONAL SUPPORT & ENCOURAGEMENT:
- Acknowledge when learners are struggling
- Provide encouragement without being patronizing
- Celebrate their efforts and progress
- Reduce test anxiety with calming language
- Remind them that learning is a process

TOOL USAGE:
- Use searchKnowledgeBase for platform help
- Use reportIssue ONLY for technical issues after troubleshooting
- Use getQuestionDetails for question information
- Use getAssignmentRubric for grading criteria
- Use submitFeedbackQuestion for feedback concerns
- Use requestRegrading for regrade requests
- Use provideFeedback for sharing general feedback about learning experience
- Use submitSuggestion for platform improvement ideas
- Use submitInquiry for general questions or inquiries

IMPORTANT: ${
      assignmentId
        ? `When calling tools that require assignmentId, always use ${assignmentId}`
        : "Assignment ID information is not available in the current context"
    }

RESPONSE STYLE:
- Warm, encouraging, and patient
- Use clear, simple language
- Break down complex explanations
- Use emojis sparingly to add warmth (🌟 ✨ 💡 🎯)
- Always end with a question or next step to keep engagement`,
  };

  return systemPrompts[userRole] || "";
}

export async function POST(req) {
  try {
    const body = await req.json();
    const cookieHeader = req.headers.get("cookie") || "";
    const { userRole, userText, conversation, userId, chatId } = body;

    if (!userRole || !userText || !conversation) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    let currentChatId = chatId;
    let newChatCreated = false;

    const systemContextMessages = conversation.filter(
      (msg) => msg.role === "system" && msg.id?.includes("context"),
    );

    const assignmentInfo = systemContextMessages.find(
      (msg) => msg.role === "system" && msg.id?.includes("context"),
    );

    let assignmentMode = "unknown";
    let isSubmitted = false;

    if (assignmentInfo?.content) {
      if (assignmentInfo.content.includes("Type: Graded assignment")) {
        assignmentMode = "graded";
        isSubmitted =
          assignmentInfo.content.includes("Student Status: PASSED") ||
          assignmentInfo.content.includes("MODE: FEEDBACK ANALYSIS");
      } else if (assignmentInfo.content.includes("Type: Practice assignment")) {
        assignmentMode = "practice";
      }
    }

    if (!currentChatId && userId) {
      try {
        const { getOrCreateTodayChat } = await import(
          "../services/markChatService"
        );

        const assignmentId =
          userRole === "learner"
            ? parseInt(assignmentInfo?.assignmentId || "0")
            : undefined;

        const chat = await getOrCreateTodayChat(userId, assignmentId);
        currentChatId = chat.id;
        newChatCreated = !chat.messages || chat.messages.length === 0;

        if (currentChatId) {
          const { addMessageToChat } = await import(
            "../services/markChatService"
          );
          await addMessageToChat(currentChatId, "USER", userText, undefined);
        }
      } catch (error) {
        console.error("Error creating chat session:", error);
      }
    }

    const regularMessages = conversation.filter(
      (msg) => msg.role !== "system" || !msg.id?.includes("context"),
    );

    const formattedMessages = [
      ...regularMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: userText },
    ];

    let trackedClientExecutions = [];
    const tools =
      userRole === "author"
        ? authorTools(cookieHeader)
        : learnerTools(cookieHeader);

    try {
      const systemPrompt = generateSystemPrompt(userRole, {
        mode: assignmentMode,
        submitted: isSubmitted,
        assignmentId:
          userRole === "learner"
            ? parseInt(assignmentInfo?.assignmentId || "0")
            : undefined,
      });

      const result = await streamText({
        model: openai("gpt-4o-mini"),
        system:
          systemPrompt +
          (systemContextMessages.length > 0
            ? "\n\n" +
              systemContextMessages.map((msg) => msg.content).join("\n\n")
            : ""),
        messages: formattedMessages,
        temperature: 0.7,
        tools: tools,
        toolChoice: "auto",
        maxTokens: 1500,
        onStepFinish: (result) => {
          if (result.toolCalls && result.toolCalls.length > 0) {
            console.group(
              `Tool calls in this step: ${result.toolCalls.length}`,
            );

            const clientExecutionRequests = [];

            result.toolCalls.forEach((call) => {
              if (
                userRole === "author" &&
                [
                  "createQuestion",
                  "modifyQuestion",
                  "setQuestionChoices",
                  "addRubric",
                  "generateQuestionVariant",
                  "deleteQuestion",
                  "generateQuestionsFromObjectives",
                  "updateLearningObjectives",
                  "setQuestionTitle",
                ].includes(call.toolName)
              ) {
                clientExecutionRequests.push({
                  function: call.toolName,
                  params: call.args,
                });
              }
            });

            console.groupEnd();

            if (clientExecutionRequests.length > 0) {
              trackedClientExecutions.push(...clientExecutionRequests);
            }
          }
        },
      });

      if (!result || !result.textStream) {
        throw new Error("Failed to generate response from AI model");
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      (async () => {
        try {
          const reader = result.textStream.getReader();
          let fullContent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            fullContent += value;
            await writer.write(new TextEncoder().encode(value));
          }

          const toolResults = (await result.toolResults) || [];
          for (const toolResult of toolResults) {
            if (toolResult && toolResult.result) {
              if (
                [
                  "reportIssue",
                  "provideFeedback",
                  "submitSuggestion",
                  "submitInquiry",
                ].includes(toolResult.toolName)
              ) {
                try {
                  const parsedResult = JSON.parse(toolResult.result);
                  if (
                    parsedResult.clientExecution &&
                    parsedResult.function === "showReportPreview"
                  ) {
                    trackedClientExecutions.push({
                      function: parsedResult.function,
                      params: parsedResult.params,
                    });
                  } else {
                    if (!fullContent.includes(toolResult.result)) {
                      const toolResponse = `\n\n${toolResult.result}`;
                      fullContent += toolResponse;
                      await writer.write(
                        new TextEncoder().encode(toolResponse),
                      );
                    }
                  }
                } catch (e) {
                  if (!fullContent.includes(toolResult.result)) {
                    const toolResponse = `\n\n${toolResult.result}`;
                    fullContent += toolResponse;
                    await writer.write(new TextEncoder().encode(toolResponse));
                  }
                }
              }
            }
          }

          if (trackedClientExecutions.length > 0) {
            const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER
${JSON.stringify(trackedClientExecutions)}
-->`;
            fullContent += marker;
            await writer.write(new TextEncoder().encode(marker));
          }

          if (currentChatId && userId) {
            try {
              const { addMessageToChat } = await import(
                "../services/markChatService"
              );
              await addMessageToChat(
                currentChatId,
                "ASSISTANT",
                fullContent,
                trackedClientExecutions.length > 0
                  ? trackedClientExecutions
                  : undefined,
              );
            } catch (error) {
              console.error("Error saving assistant response:", error);
            }
          }

          await writer.close();
        } catch (error) {
          await writer.abort(error);
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Chat-ID": currentChatId || "",
          "X-Chat-Created": newChatCreated ? "true" : "false",
          "X-Assignment-Mode": assignmentMode,
          "X-Assignment-Submitted": isSubmitted ? "true" : "false",
        },
      });
    } catch (aiError) {
      return new Response(STANDARD_ERROR_MESSAGE, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  } catch (error) {
    return new Response(STANDARD_ERROR_MESSAGE, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
