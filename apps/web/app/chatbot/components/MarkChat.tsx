"use client";
/* eslint-disable */
import MarkFace from "@/public/MarkFace.svg";
import {
  AcademicCapIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  PencilIcon,
  PlusCircleIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
  ChatBubbleBottomCenterTextIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowPathIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
  ChatBubbleOvalLeftEllipsisIcon,
} from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuthorContext } from "../store/useAuthorContext";
import { useLearnerContext } from "../store/useLearnerContext";
import { ChatRole, useMarkChatStore } from "../store/useMarkChatStore";
import { toast } from "sonner";
import {
  getOrCreateTodayChat,
  findTodayChat,
  addMessageToChat,
  endChat,
  getUser,
  type ChatMessage as SavedChatMessage,
} from "@/lib/shared";
import { submitBugReport } from "@/lib/report-client";
import ReportPreviewModal from "@/components/ReportPreviewModal";
import { useChatbot } from "../../../hooks/useChatbot";
import { useCallback } from "react";
import type { User } from "@/config/types";

let cachedUser: User | null = null;
let cachedUserPromise: Promise<User | null> | null = null;

const fetchUserCached = async (): Promise<User | null> => {
  if (cachedUser) return cachedUser;
  if (!cachedUserPromise) {
    cachedUserPromise = getUser()
      .then((user) => {
        cachedUser = user ?? null;
        return cachedUser;
      })
      .catch((error) => {
        cachedUserPromise = null;
        throw error;
      });
  }
  return cachedUserPromise;
};

const CLIENT_EXECUTION_MARKER =
  /\s*<!-- CLIENT_EXECUTION_MARKER\n[\S\s]*?\n-->/g;

// A saved reply records the report form it opened, in its text and in toolCalls.
// Loading it must show neither, or the form opens again on every load.
const toStoreMessages = (savedMessages: SavedChatMessage[]) =>
  savedMessages.map((msg) => ({
    id: `msg-${msg.id}`,
    role: msg.role.toLowerCase() as ChatRole,
    content: msg.content.replace(CLIENT_EXECUTION_MARKER, ""),
    timestamp: new Date(msg.timestamp).toISOString(),
  }));

const SuggestionsPanel = ({
  suggestions,
  insertSuggestion,
  setShowSuggestions,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mb-2"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 mb-1.5 ml-1">Suggestions:</div>
        <button
          onClick={() => setShowSuggestions(false)}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <XMarkIcon className="w-3 h-3" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={suggestion}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => insertSuggestion(suggestion)}
            className="flex-shrink-0 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 text-gray-700 dark:text-gray-300 hover:text-purple-700 dark:hover:text-purple-300 rounded-full transition-colors"
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
};

const QuestionSelector = ({
  userRole,
  learnerContext,
  activeQuestion,
  handleSwitchQuestion,
}) => {
  if (
    userRole !== "learner" ||
    !learnerContext.questions ||
    learnerContext.questions.length <= 1
  ) {
    return null;
  }
  return (
    <div className="px-4 py-2 mb-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <ChatBubbleOvalLeftEllipsisIcon className="w-4 h-4 text-purple-500" />
          Question Focus
        </div>
        <select
          className="text-sm border border-gray-300 rounded-md p-1 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
          value={activeQuestion || ""}
          onChange={(e) => handleSwitchQuestion(Number(e.target.value))}
        >
          {learnerContext.questions.map((question, index) => (
            <option key={question.id} value={question.id}>
              Question {index + 1}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

const SpecialActionUI = ({
  specialActions,
  handleIssueReport,
  handleCreateQuestion,
  handleReportPreview,
  handleFeedback,
  handleSuggestion,
  handleInquiry,
}) => {
  if (!specialActions.show) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="px-4 py-2 mb-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md"
    >
      {specialActions.type === "report" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <h4 className="text-sm font-medium">Report an Issue</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            It looks like you're experiencing an issue with the platform or
            assignment. I can help you submit a formal issue report.
          </p>
          <button
            onClick={handleIssueReport}
            className="text-xs py-1.5 px-3 bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800 text-red-800 dark:text-red-200 rounded-md transition-colors self-end mt-1"
          >
            Continue with issue report
          </button>
        </div>
      ) : specialActions.type === "create" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
            <PlusCircleIcon className="w-5 h-5" />
            <h4 className="text-sm font-medium">Create a Question</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            I can help you create a new question. What type of question would
            you like to create?
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            <button
              onClick={() => handleCreateQuestion("multiple-choice")}
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "multiple-choice"
                  ? "bg-purple-200 text-purple-900 dark:bg-purple-700 dark:text-purple-100"
                  : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              } hover:bg-purple-200 dark:hover:bg-purple-800 rounded-md transition-colors`}
            >
              Multiple Choice
            </button>
            <button
              onClick={() => handleCreateQuestion("true/false")}
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "true/false"
                  ? "bg-purple-200 text-purple-900 dark:bg-purple-700 dark:text-purple-100"
                  : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              } hover:bg-purple-200 dark:hover:bg-purple-800 rounded-md transition-colors`}
            >
              True/False
            </button>
            <button
              onClick={() => handleCreateQuestion("text response")}
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "text response"
                  ? "bg-purple-200 text-purple-900 dark:bg-purple-700 dark:text-purple-100"
                  : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              } hover:bg-purple-200 dark:hover:bg-purple-800 rounded-md transition-colors`}
            >
              Text Response
            </button>
          </div>
        </div>
      ) : specialActions.type === "feedback" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <ChatBubbleBottomCenterTextIcon className="w-5 h-5" />
            <h4 className="text-sm font-medium">Share Your Feedback</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            I'd love to hear about your experience with the platform. Your
            feedback helps us improve!
          </p>
          <button
            onClick={handleFeedback}
            className="text-xs py-1.5 px-3 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-md transition-colors self-end mt-1"
          >
            Share feedback
          </button>
        </div>
      ) : specialActions.type === "suggestion" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <LightBulbIcon className="w-5 h-5" />
            <h4 className="text-sm font-medium">Share Your Suggestion</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            I'd love to hear your ideas for improving the platform or adding new
            features!
          </p>
          <button
            onClick={handleSuggestion}
            className="text-xs py-1.5 px-3 bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 rounded-md transition-colors self-end mt-1"
          >
            Share suggestion
          </button>
        </div>
      ) : specialActions.type === "inquiry" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
            <QuestionMarkCircleIcon className="w-5 h-5" />
            <h4 className="text-sm font-medium">Ask a Question</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            I'm here to help answer your questions and provide assistance with
            whatever you need.
          </p>
          <button
            onClick={handleInquiry}
            className="text-xs py-1.5 px-3 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900 dark:hover:bg-indigo-800 text-indigo-800 dark:text-indigo-200 rounded-md transition-colors self-end mt-1"
          >
            Ask question
          </button>
        </div>
      ) : null}
    </motion.div>
  );
};

const WelcomeMessage = ({
  getAccentColor,
  userRole,
  MarkFace,
  learnerContext,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="text-center p-6"
    >
      <div
        className={`w-16 h-16 mx-auto bg-gradient-to-r ${getAccentColor()} rounded-full flex items-center justify-center mb-4`}
      >
        {userRole === "author" ? (
          MarkFace ? (
            <Image
              src={MarkFace}
              alt="Mark AI Assistant"
              width={40}
              height={40}
            />
          ) : (
            <PencilIcon className="w-8 h-8 text-white" />
          )
        ) : MarkFace ? (
          <Image
            src={MarkFace}
            alt="Mark AI Assistant"
            width={40}
            height={40}
          />
        ) : (
          <ChatBubbleLeftRightIcon className="w-8 h-8 text-white" />
        )}
      </div>
      <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">
        How can I help you today?
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {userRole === "author"
          ? "I can create questions, generate content, and design your assessment. Just tell me what you need!"
          : learnerContext.isFeedbackMode
            ? "I can explain your feedback, clarify marking, and help you understand your assessment results."
            : learnerContext.isGradedAssignment
              ? "I can clarify assignment requirements and guide you without providing direct answers."
              : "I can provide hints, explanations, and help you practice effectively."}
      </p>

      {userRole === "learner" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
          {learnerContext.isGradedAssignment && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg text-left border border-amber-200 dark:border-amber-800">
              <h4 className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-2 flex items-center">
                <SparklesIcon className="w-4 h-4 mr-1.5" />
                Graded Assignment Rules
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                I'll help you understand concepts and requirements, but won't
                provide specific answers for graded work.
              </p>
            </div>
          )}

          {learnerContext.isFeedbackMode && (
            <div className="p-3 bg-orange-50 dark:bg-orange-900/30 rounded-lg text-left border border-orange-200 dark:border-orange-800">
              <h4 className="text-sm font-medium text-orange-800 dark:text-orange-400 mb-2 flex items-center">
                <QuestionMarkCircleIcon className="w-4 h-4 mr-1.5" />
                Need help with your grades?
              </h4>
              <p className="text-xs text-orange-700 dark:text-orange-300">
                I can explain your feedback and help you understand how your
                assessment was scored.
              </p>
            </div>
          )}

          {!learnerContext.isGradedAssignment &&
            !learnerContext.isFeedbackMode && (
              <div className="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg text-left border border-purple-200 dark:border-purple-800">
                <h4 className="text-sm font-medium text-purple-800 dark:text-purple-400 mb-2 flex items-center">
                  <AcademicCapIcon className="w-4 h-4 mr-1.5" />
                  Practice Mode
                </h4>
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  I can provide detailed hints, explanations, and practice
                  guidance to help you learn effectively.
                </p>
              </div>
            )}

          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-left border border-indigo-200 dark:border-indigo-800">
            <h4 className="text-sm font-medium text-indigo-800 dark:text-indigo-400 mb-2 flex items-center">
              <InformationCircleIcon className="w-4 h-4 mr-1.5" />
              Assignment Support
            </h4>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              Ask me to focus on specific questions, explain concepts, or
              clarify instructions to improve your understanding.
            </p>
          </div>
        </div>
      )}

      {userRole === "author" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg text-left border border-purple-200 dark:border-purple-800">
            <h4 className="text-sm font-medium text-purple-800 dark:text-purple-400 mb-2 flex items-center">
              <SparklesIcon className="w-4 h-4 mr-1.5" />
              Question Creation
            </h4>
            <p className="text-xs text-purple-700 dark:text-purple-300">
              I can create multiple choice, true/false, and text response
              questions from your specifications or learning objectives.
            </p>
          </div>

          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-left border border-indigo-200 dark:border-indigo-800">
            <h4 className="text-sm font-medium text-indigo-800 dark:text-indigo-400 mb-2 flex items-center">
              <PencilIcon className="w-4 h-4 mr-1.5" />
              Question Improvement
            </h4>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              I can help improve existing questions, create variants, design
              rubrics, and enhance assessment quality.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const ChatMessages = ({
  messages,
  chatBubbleVariants,
  getAccentColor,
  renderTypingIndicator,
  onClientExecution,
  processedMessageIds,
}) => {
  const filteredMessages = React.useMemo(() => {
    return messages.filter((msg) => {
      if (msg.role === "system") return false;
      if (msg.role !== "assistant") return true;
      if (msg.content.trim().length > 0) return true;
      if (Array.isArray(msg.toolCalls)) {
        return msg.toolCalls.some(
          (toolCall) => toolCall.function === "showReportPreview",
        );
      }
      return false;
    });
  }, [messages]);

  React.useEffect(() => {
    if (onClientExecution) {
      filteredMessages.forEach((msg) => {
        if (
          !processedMessageIds.has(msg.id) &&
          msg.role === "assistant" &&
          msg.toolCalls &&
          Array.isArray(msg.toolCalls)
        ) {
          msg.toolCalls.forEach((toolCall) => {
            if (toolCall.function === "showReportPreview") {
              onClientExecution(toolCall);
            }
          });

          processedMessageIds.add(msg.id);
        }
      });
    }
  }, [filteredMessages, onClientExecution, processedMessageIds]);

  return (
    <>
      {filteredMessages.map((msg, index) => {
        const messageContent = msg.content;

        return (
          <motion.div
            key={msg.id}
            custom={index}
            variants={chatBubbleVariants}
            initial="hidden"
            animate="visible"
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-xl p-3 ${
                msg.role === "user"
                  ? `bg-gradient-to-r ${getAccentColor()} text-white`
                  : "bg-white dark:bg-gray-800 shadow-md border dark:border-gray-700"
              }`}
            >
              <div className="prose dark:prose-invert text-sm max-w-none">
                <ReactMarkdown>{messageContent}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        );
      })}
      {renderTypingIndicator()}
    </>
  );
};

export const MarkChat = () => {
  const {
    isOpen: isChatbotOpen,
    toggle: toggleChatbot,
    isUnavailable: isChatUnavailable,
    markUnavailable: markChatUnavailable,
  } = useChatbot();
  const {
    messages,
    userInput,
    setUserInput,
    sendMessage,
    isTyping,
    userRole,
    resetChat,
  } = useMarkChatStore();

  const learnerContext = useLearnerContext();
  const authorContext = useAuthorContext();

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const isSendingRef = useRef(false);
  const processedClientExecutions = useRef(new Set<string>());
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [specialActions, setSpecialActions] = useState({
    show: false,
    type: null,
    data: null,
  });
  const [dismissedActions, setDismissedActions] = useState(new Set());

  const generateActionKey = useCallback((type, context) => {
    const baseKey = `${type}-${context.assignmentId || "general"}`;
    return baseKey;
  }, []);

  const dismissAction = useCallback(
    (type, context) => {
      const key = generateActionKey(type, context);
      setDismissedActions((prev) => {
        const newSet = new Set(prev);
        newSet.add(key);
        return newSet;
      });
      setSpecialActions({ show: false, type: null, data: null });
    },
    [generateActionKey],
  );

  const [user, setUser] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(null);

  const [isInitializing, setIsInitializing] = useState(true);
  const [isEndingChat, setIsEndingChat] = useState(false);
  const [reportPreviewModal, setReportPreviewModal] = useState({
    isOpen: false,
    type: "report" as "report" | "feedback" | "suggestion" | "inquiry",
    data: null as any,
  });
  const context = userRole === "learner" ? learnerContext : authorContext;
  useEffect(() => {
    let cancelled = false;
    const fetchUser = async () => {
      try {
        const userData = await fetchUserCached();
        if (!cancelled) {
          setUser(userData);
        }
      } catch (error) {
        console.error("MarkChat: fetchUser failed:", error);
      }
    };
    void fetchUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const getCurrentAssignmentId = useCallback(() => {
    const assignmentId =
      userRole === "learner"
        ? learnerContext.assignmentId
        : userRole === "author"
          ? authorContext.activeAssignmentId
          : undefined;

    return assignmentId != null && Number.isFinite(Number(assignmentId))
      ? Number(assignmentId)
      : undefined;
  }, [userRole, learnerContext.assignmentId, authorContext.activeAssignmentId]);

  useEffect(() => {
    if (!user?.userId) {
      setIsInitializing(false);
      return;
    }

    let cancelled = false;
    const assignmentId = getCurrentAssignmentId();
    setIsInitializing(true);

    const initializeChat = async () => {
      try {
        const todayChat = await findTodayChat(user.userId, assignmentId);

        if (cancelled) return;

        if (!todayChat.id) {
          setCurrentChatId(null);
          resetChat();
          return;
        }

        setCurrentChatId(todayChat.id);

        if (todayChat.messages && todayChat.messages.length > 0) {
          useMarkChatStore.setState({
            messages: toStoreMessages(todayChat.messages),
          });
        } else {
          resetChat();
        }
      } catch (error) {
        if (cancelled) return;
        // A 403 means this session simply has no chat access (e.g. the
        // learner's group isn't linked to the assignment). That's a policy
        // outcome, not a malfunction — hide the chat instead of toasting an
        // error on every page the widget mounts on.
        if ((error as { status?: number }).status === 403) {
          console.warn("Chat unavailable for this session (403)");
          markChatUnavailable();
        } else {
          console.error("initializeChat failed:", error);
          toast.error("Could not load chat session");
        }
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    initializeChat();
    return () => {
      cancelled = true;
    };
  }, [
    user?.userId,
    userRole,
    learnerContext.assignmentId,
    authorContext.activeAssignmentId,
    getCurrentAssignmentId,
    markChatUnavailable,
    resetChat,
  ]);

  useEffect(() => {
    if (userRole === "learner" && learnerContext.currentQuestion) {
      setActiveQuestion(learnerContext.currentQuestion.id);
    }
  }, [userRole, learnerContext]);

  const checkForLearnerSpecialActions = useCallback(
    (input) => {
      const lowerInput = input.toLowerCase();
      if (
        lowerInput.includes("issue") ||
        lowerInput.includes("problem with") ||
        lowerInput.includes("bug") ||
        lowerInput.includes("doesn't work") ||
        lowerInput.includes("error") ||
        lowerInput.includes("glitch") ||
        lowerInput.includes("not working") ||
        lowerInput.includes("broken") ||
        lowerInput.match(/can't(?:.+?)load/) ||
        lowerInput.match(/won't(?:.+?)display/)
      ) {
        const actionKey = generateActionKey("report", {
          assignmentId: learnerContext.assignmentId,
        });
        if (!dismissedActions.has(actionKey)) {
          setSpecialActions({
            show: true,
            type: "report",
            data: { assignmentId: learnerContext.assignmentId },
          });
        }
      } else if (
        lowerInput.includes("feedback") ||
        lowerInput.includes("improve") ||
        lowerInput.includes("better") ||
        lowerInput.includes("experience") ||
        lowerInput.includes("what do you think") ||
        lowerInput.includes("opinion") ||
        lowerInput.includes("thoughts") ||
        lowerInput.includes("comment") ||
        lowerInput.includes("review") ||
        lowerInput.match(/how (was|is) (this|the)/) ||
        lowerInput.match(/rate (this|the)/)
      ) {
        setSpecialActions({
          show: true,
          type: "feedback",
          data: { assignmentId: learnerContext.assignmentId },
        });
      } else if (
        lowerInput.includes("suggest") ||
        lowerInput.includes("recommendation") ||
        lowerInput.includes("feature") ||
        lowerInput.includes("enhancement") ||
        lowerInput.includes("would be nice") ||
        lowerInput.includes("could you") ||
        lowerInput.includes("wish") ||
        lowerInput.includes("idea") ||
        lowerInput.match(/what if/) ||
        lowerInput.match(/how about/) ||
        lowerInput.match(/maybe (you|we) could/)
      ) {
        setSpecialActions({
          show: true,
          type: "suggestion",
          data: { assignmentId: learnerContext.assignmentId },
        });
      } else if (
        (lowerInput.includes("question") &&
          !lowerInput.includes("quiz question") &&
          !lowerInput.includes("test question")) ||
        lowerInput.includes("help") ||
        lowerInput.includes("how to") ||
        lowerInput.includes("can you") ||
        lowerInput.includes("inquiry") ||
        lowerInput.includes("ask") ||
        lowerInput.includes("support") ||
        lowerInput.includes("assistance") ||
        lowerInput.includes("confused") ||
        lowerInput.includes("don't understand") ||
        lowerInput.match(/what (is|are)/) ||
        lowerInput.match(/how (do|does)/) ||
        lowerInput.match(/why (is|does|do)/)
      ) {
        setSpecialActions({
          show: true,
          type: "inquiry",
          data: { assignmentId: learnerContext.assignmentId },
        });
      } else {
        setSpecialActions({ show: false, type: null, data: null });
      }
    },
    [learnerContext, generateActionKey, dismissedActions],
  );

  const checkForAuthorSpecialActions = useCallback((input) => {
    const lowerInput = input.toLowerCase();
    const createPatterns = [
      "create",
      "add",
      "new",
      "make",
      "generate",
      "build",
      "design",
      "develop",
    ];

    const questionPatterns = [
      "question",
      "multiple choice",
      "true/false",
      "text response",
      "mc question",
      "t/f",
      "essay",
      "prompt",
      "quiz item",
      "assessment item",
      "mcq",
    ];

    const hasCreateIntent = createPatterns.some((pattern) =>
      lowerInput.includes(pattern),
    );
    const hasQuestionIntent = questionPatterns.some((pattern) =>
      lowerInput.includes(pattern),
    );
    if (hasCreateIntent && hasQuestionIntent) {
      let questionType = "multiple-choice";
      if (
        lowerInput.match(/multiple.{0,10}choice/) ||
        lowerInput.includes("mc") ||
        lowerInput.includes("mcq")
      ) {
        questionType = "multiple-choice";
      } else if (
        lowerInput.match(/true.{0,5}false/) ||
        lowerInput.includes("t/f") ||
        lowerInput.includes("tf question")
      ) {
        questionType = "true/false";
      } else if (
        lowerInput.match(/text.{0,10}response/) ||
        lowerInput.includes("essay") ||
        lowerInput.includes("free response") ||
        lowerInput.includes("written response") ||
        lowerInput.includes("open ended")
      ) {
        questionType = "text response";
      }
      setSpecialActions({
        show: true,
        type: "create",
        data: {
          questionTypes: [
            "SINGLE_CORRECT",
            "MULTIPLE_CORRECT",
            "TEXT",
            "TRUE_FALSE",
          ],

          suggestedType: questionType,
        },
      });
    } else if (
      lowerInput.includes("feedback") ||
      lowerInput.includes("improve") ||
      lowerInput.includes("better") ||
      lowerInput.includes("experience") ||
      lowerInput.includes("what do you think") ||
      lowerInput.includes("opinion") ||
      lowerInput.includes("thoughts") ||
      lowerInput.includes("comment") ||
      lowerInput.includes("review") ||
      lowerInput.match(/how (was|is) (this|the)/) ||
      lowerInput.match(/rate (this|the)/)
    ) {
      setSpecialActions({
        show: true,
        type: "feedback",
        data: { context: "author feedback" },
      });
    } else if (
      lowerInput.includes("suggest") ||
      lowerInput.includes("recommendation") ||
      lowerInput.includes("feature") ||
      lowerInput.includes("enhancement") ||
      lowerInput.includes("would be nice") ||
      lowerInput.includes("could you") ||
      lowerInput.includes("wish") ||
      lowerInput.includes("idea") ||
      lowerInput.match(/what if/) ||
      lowerInput.match(/how about/) ||
      lowerInput.match(/maybe (you|we) could/)
    ) {
      setSpecialActions({
        show: true,
        type: "suggestion",
        data: { context: "author suggestion" },
      });
    } else if (
      (lowerInput.includes("question") && !hasQuestionIntent) ||
      lowerInput.includes("help") ||
      lowerInput.includes("how to") ||
      lowerInput.includes("can you") ||
      lowerInput.includes("inquiry") ||
      lowerInput.includes("ask") ||
      lowerInput.includes("support") ||
      lowerInput.includes("assistance") ||
      lowerInput.includes("confused") ||
      lowerInput.includes("don't understand") ||
      lowerInput.match(/what (is|are)/) ||
      lowerInput.match(/how (do|does)/) ||
      lowerInput.match(/why (is|does|do)/)
    ) {
      setSpecialActions({
        show: true,
        type: "inquiry",
        data: { context: "author inquiry" },
      });
    } else {
      setSpecialActions({ show: false, type: null, data: null });
    }
  }, []);

  const handleSendWithContext = useCallback(
    async (stream = true) => {
      if (isSendingRef.current) return;

      const trimmedInput = userInput.trim();
      if (!trimmedInput) return;

      isSendingRef.current = true;

      setHistory((prev) => [...prev, trimmedInput]);
      setHistoryIndex(-1);

      try {
        let contextMessage = null;
        try {
          contextMessage = await context.getContextMessage();
        } catch (error) {
          console.warn("Failed to build context message:", error);
        }

        const originalMessages = messages.filter(
          (message) =>
            message.role !== "system" || !message.id.includes("context"),
        );
        const messagesWithContext = [...originalMessages];

        if (contextMessage) {
          const lastUserMsgIndex = messagesWithContext
            .map((message, index) => (message.role === "user" ? index : -1))
            .filter((index) => index !== -1)
            .pop();

          if (lastUserMsgIndex !== undefined) {
            messagesWithContext.splice(lastUserMsgIndex, 0, {
              ...contextMessage,
            });
          } else {
            const systemIndex = messagesWithContext.findIndex(
              (message) => message.role === "system",
            );
            const insertPosition = systemIndex !== -1 ? systemIndex + 1 : 0;
            messagesWithContext.splice(insertPosition, 0, {
              ...contextMessage,
            });
          }
        }

        if (userRole === "learner") {
          checkForLearnerSpecialActions(trimmedInput);
        } else {
          checkForAuthorSpecialActions(trimmedInput);
        }

        useMarkChatStore.setState({ messages: messagesWithContext });
        const browserCookies =
          typeof window !== "undefined" ? document.cookie : "";
        if (user?.userId) {
          let chatId = currentChatId;
          if (!chatId) {
            try {
              const created = await getOrCreateTodayChat(
                user.userId,
                getCurrentAssignmentId(),
                browserCookies,
              );
              chatId = created.id;
              setCurrentChatId(created.id);
            } catch (error) {
              console.error("MarkChat: getOrCreateTodayChat failed:", error);
            }
          }
          if (chatId) {
            try {
              await addMessageToChat(
                chatId,
                "USER",
                trimmedInput,
                browserCookies,
              );
            } catch (error) {
              console.error(
                "MarkChat: addMessageToChat(USER) failed — chat log may be incomplete:",
                error,
              );
            }
          }
        }

        await sendMessage(stream, {
          userText: trimmedInput,
        });
      } catch (error) {
        toast.error("Failed to send message. Please try again.");
      } finally {
        isSendingRef.current = false;
        setTimeout(() => {
          const purified = useMarkChatStore
            .getState()
            .messages.filter(
              (message) =>
                message.role !== "system" || !message.id.includes("context"),
            );
          useMarkChatStore.setState({ messages: purified });
        }, 500);
      }

      setShowSuggestions(false);
    },
    [
      userInput,
      context,
      messages,
      userRole,
      sendMessage,
      checkForLearnerSpecialActions,
      checkForAuthorSpecialActions,
      currentChatId,
      user?.userId,
      getCurrentAssignmentId,
    ],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendWithContext(true);
      } else if (
        e.key === "ArrowUp" &&
        userInput === "" &&
        history.length > 0
      ) {
        e.preventDefault();
        const newIndex =
          historyIndex === -1
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setUserInput(history[newIndex]);
      } else if (e.key === "ArrowDown" && historyIndex !== -1) {
        e.preventDefault();
        if (historyIndex === history.length - 1) {
          setHistoryIndex(-1);
          setUserInput("");
        } else {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setUserInput(history[newIndex]);
        }
      }
    },
    [handleSendWithContext, history, historyIndex, userInput],
  );

  useEffect(() => {
    if (isChatbotOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isChatbotOpen]);

  useEffect(() => {
    if (isChatbotOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 300);
    }
  }, [isChatbotOpen]);

  const insertSuggestion = useCallback((suggestion) => {
    setUserInput(suggestion);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (userInput.trim() !== "") {
      setShowSuggestions(false);
    }
  }, [userInput]);

  const handleIssueReport = useCallback(() => {
    try {
      const reportPrompt = `I'd like to report an issue with assignment ${
        learnerContext.assignmentId || "this assignment"
      }. The problem I'm experiencing is...`;

      setUserInput(reportPrompt);
      dismissAction("report", { assignmentId: learnerContext.assignmentId });
      textareaRef.current?.focus();
    } catch (error) {
      toast.error(
        "There was a problem setting up the issue report. Please try again.",
      );
    }
  }, [learnerContext, dismissAction]);

  const handleCreateQuestion = useCallback((type) => {
    let createPrompt = "";
    switch (type) {
      case "multiple-choice":
        createPrompt = `I'd like to create a new multiple-choice question. Here's what I'm thinking:

Question: 
Options:
1. [First option - correct]
2. [Second option]
3. [Third option]
4. [Fourth option]

Can you help me complete and implement this question?`;
        break;
      case "true/false":
        createPrompt = `I'd like to create a new true/false question. Here's what I'm thinking:

Statement: 
Correct answer: [True/False]

Can you help me complete and implement this question?`;
        break;
      case "text response":
        createPrompt = `I'd like to create a new text response question. Here's what I'm thinking:

Question: 
Rubric criteria:
- [First criterion]
- [Second criterion]

Can you help me complete and implement this question?`;
        break;
      default:
        createPrompt = `I'd like to create a new ${type} question for my assignment. The question should be about...`;
    }
    setUserInput(createPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  }, []);

  const handleFeedback = useCallback(() => {
    const feedbackPrompt = `I'd like to provide feedback about my experience:

Overall Experience: 
What's working well: 
What could be improved: 
Additional comments: 

Please help me submit this feedback.`;
    setUserInput(feedbackPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  }, []);

  const handleSuggestion = useCallback(() => {
    const suggestionPrompt = `I have a suggestion for improvement:

Feature/Enhancement: 
Why it would be helpful: 
How it might work: 

Please help me submit this suggestion.`;
    setUserInput(suggestionPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  }, []);

  const handleInquiry = useCallback(() => {
    const inquiryPrompt = `I have a question and need assistance:

My question: 
What I'm trying to do: 
What I've tried so far: 

Please help me with this.`;
    setUserInput(inquiryPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  }, []);

  const handleReportPreview = useCallback(
    async (action, value) => {
      if (action === "cancel") {
        const actionData = specialActions.data || {};
        dismissAction(specialActions.type, {
          assignmentId: actionData.assignmentId,
        });
        return;
      }

      if (action === "submit") {
        try {
          const reportData = value || specialActions.data;
          const resolvedUserEmail = reportData?.userEmail || user?.userId;

          // Shared with the flag button and the error dialog so all three
          // reports carry the same fields (page URL, browser, toasts).
          const submitted = await submitBugReport(
            {
              issueType: reportData.issueType,
              description: reportData.description,
              severity: reportData.severity,
              screenshot: reportData.screenshot,
              userEmail: resolvedUserEmail,
              assignmentId:
                reportData.assignmentId ??
                learnerContext?.assignmentId ??
                authorContext?.activeAssignmentId,
            },
            {
              category: reportData.category || "Issue Report",
              user,
              userRole: reportData.userRole,
            },
          );

          if (!submitted) return;

          useMarkChatStore.getState().addMessage({
            id: Date.now().toString(),
            role: "assistant",
            content: "Report submitted successfully!",
            timestamp: new Date().toISOString(),
          });

          dismissAction("report", { assignmentId: reportData.assignmentId });
          setReportPreviewModal({ isOpen: false, type: "report", data: null });
        } catch (error) {
          console.error("Error submitting report:", error);
          toast.error("Failed to submit report. Please try again.");
        }
        return;
      }

      if (typeof value !== "undefined") {
        setSpecialActions((prev) => ({
          ...prev,
          data: {
            ...prev.data,
            [action]: value,
          },
        }));
      }
    },
    [specialActions, dismissAction],
  );

  const handleClientExecution = useCallback(
    (toolCall) => {
      if (toolCall.function === "showReportPreview") {
        setReportPreviewModal({
          isOpen: true,
          type: toolCall.params.type || "report",
          data: {
            ...toolCall.params,
            userEmail: user?.userId,
          },
        });
      }
    },
    [user?.userId],
  );

  const handleSwitchQuestion = useCallback(
    (questionId) => {
      if (userRole === "learner" && learnerContext.questions) {
        const questionIndex = learnerContext.questions.findIndex(
          (q) => q.id === questionId,
        );
        if (questionIndex >= 0) {
          setActiveQuestion(questionId);
          if (typeof learnerContext.setActiveQuestionNumber === "function") {
            learnerContext.setActiveQuestionNumber(questionIndex + 1);
            toast.success(`Focused on Question ${questionIndex + 1}`);
          } else {
            toast.info(`Focused on Question ${questionIndex + 1} (UI only)`);
          }
        }
      }
    },
    [userRole, learnerContext],
  );

  const handleEndChat = useCallback(async () => {
    if (!user?.userId || isInitializing || isEndingChat) return;
    setIsEndingChat(true);
    try {
      if (!currentChatId) {
        resetChat();
        toast.success("Started a new chat session");
        return;
      }

      await endChat(currentChatId);

      setCurrentChatId(null);
      resetChat();

      toast.success("Started a new chat session");
    } catch (error) {
      console.error("handleEndChat failed:", error);
      toast.error("Could not end chat session");
    } finally {
      setIsEndingChat(false);
    }
  }, [isInitializing, isEndingChat, currentChatId, user?.userId, resetChat]);

  const getHelperText = useCallback(() => {
    if (userRole === "author") {
      if (authorContext.focusedQuestionId) {
        const question = authorContext.getCurrentQuestionInfo();
        if (!question) return "I can help you improve this question";
        const questionType = question.type;
        if (
          questionType === "MULTIPLE_CORRECT" ||
          questionType === "SINGLE_CORRECT"
        ) {
          return "I can help improve options, create variants, or modify scoring";
        } else if (questionType === "TEXT") {
          return "I can help build rubrics and refine the prompt";
        } else if (questionType === "TRUE_FALSE") {
          return "I can help create variants or convert to other formats";
        }
        return "I can help you improve this question";
      }
      return "I can create questions, build rubrics, and design assessments";
    }
    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return "I can explain your feedback and suggest improvements";
      }
      return learnerContext.isGradedAssignment
        ? "I'll clarify requirements without providing answers"
        : "I can provide hints and guidance for this practice";
    }
    return "I'm here to help with your educational tasks";
  }, [userRole, authorContext, learnerContext]);

  const getAccentColor = useCallback(() => {
    if (userRole === "author") return "from-purple-600 to-indigo-600";
    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) return "from-orange-600 to-amber-600";
      return learnerContext.isGradedAssignment
        ? "from-amber-600 to-yellow-600"
        : "from-purple-600 to-cyan-600";
    }
    return "from-purple-600 to-purple-600";
  }, [userRole, learnerContext]);

  const suggestions = React.useMemo(() => {
    if (userRole === "author") {
      const focusedQuestionId = authorContext.focusedQuestionId;
      const questionInfo = focusedQuestionId
        ? authorContext.getCurrentQuestionInfo()
        : null;
      if (focusedQuestionId && questionInfo) {
        switch (questionInfo.type) {
          case "MULTIPLE_CORRECT":
          case "SINGLE_CORRECT":
            return [
              "Improve this multiple choice question",
              "Add more distractor options",
              "Make the options more challenging",
              "Generate variations of this question",
              "Update the scoring for this question",
              "Make this question clearer",
            ];

          case "TEXT":
            return [
              "Add a detailed rubric for this question",
              "Generate evaluation criteria",
              "Suggest sample answer for this question",
              "Make the prompt more specific",
              "Set word count limits for this response",
              "Create a variant of this text question",
            ];

          case "TRUE_FALSE":
            return [
              "Convert this to multiple choice",
              "Generate variations of this true/false",
              "Make the statement more nuanced",
              "Create a related false statement",
              "Add explanation for the correct answer",
              "Make this question clearer",
            ];

          default:
            return [
              "Improve this question",
              "Create variations of this question",
              "Add scoring criteria",
              "Make the question clearer",
              "Adjust the difficulty level",
              "Delete this question",
            ];
        }
      }
      return [
        "Create a multiple choice question about...",
        "Generate a set of true/false questions",
        "Create a text response essay question",
        "Generate questions from learning objectives",
        "Help me design assessment criteria",
        "Create questions that test critical thinking",
      ];
    }
    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return [
          "Explain my feedback for this question",
          "How can I improve my answer next time?",
          "Why did I lose points on this question?",
          "What concepts did I miss in my answer?",
          "Help me understand this grading criteria",
          "What can I do if my grade seems wrong?",
        ];
      }
      if (learnerContext.isGradedAssignment) {
        return [
          "What is this question asking for?",
          "Clarify the requirements for this question",
          "What concepts should I understand for this?",
          "How do I approach this type of question?",
          "What does this instruction mean?",
          "Report an issue with this question",
        ];
      } else {
        return [
          "Can you explain the key concepts for this?",
          "What's the best approach for this question?",
          "I'm stuck on this part, can you help?",
          "What background knowledge do I need here?",
          "Can you give me a hint for this problem?",
          "How do I structure my answer for this?",
        ];
      }
    }
    return [
      "How can you help me?",
      "What can you do?",
      "I need assistance with this assignment",
      "Can you explain how this works?",
    ];
  }, [userRole, authorContext, learnerContext]);

  useEffect(() => {
    if (userRole === "learner" && learnerContext.assignmentId) {
      resetChat();
    } else if (userRole === "author" && authorContext.activeAssignmentId) {
      resetChat();
    }
  }, [
    userRole,
    resetChat,
    learnerContext.assignmentId,
    authorContext.activeAssignmentId,
  ]);

  const clearInput = useCallback(() => {
    setUserInput("");
    textareaRef.current?.focus();
  }, []);

  const chatBubbleVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (i) => ({
      scale: 1,
      opacity: 1,
      transition: {
        delay: i * 0.1,
        type: "spring",
        stiffness: 400,
        damping: 20,
      },
    }),
  };

  const renderTypingIndicator = useCallback(() => {
    if (!isTyping) return null;
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl p-3 bg-white dark:bg-gray-800 shadow-md border dark:border-gray-700">
          <div className="flex space-x-1 items-center h-6">
            <div
              className="w-2 h-2 rounded-full bg-purple-500 dark:bg-purple-400 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />

            <div
              className="w-2 h-2 rounded-full bg-purple-500 dark:bg-purple-400 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />

            <div
              className="w-2 h-2 rounded-full bg-purple-500 dark:bg-purple-400 animate-bounce"
              style={{ animationDelay: "600ms" }}
            />
          </div>
        </div>
      </div>
    );
  }, [isTyping]);

  const isSendDisabled = !userInput.trim() || isTyping || isInitializing;
  const hasConversation = messages.some(
    (message) =>
      message.role !== "system" && message.id !== "assistant-initial",
  );

  // Chat access was denied for this session — render nothing (the toggle
  // button hides itself off the same store flag).
  if (isChatUnavailable) {
    return null;
  }

  return (
    <>
      <AnimatePresence>
        {isChatbotOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width:
                typeof window !== "undefined" && window.innerWidth < 768
                  ? "100vw"
                  : "25vw",
              opacity: 1,
            }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
            className="h-full bg-white dark:bg-gray-900 shadow-2xl border-l md:border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden font-sans relative z-[9999]"
          >
            <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-2 md:space-x-3">
                {MarkFace && (
                  <Image
                    src={MarkFace}
                    alt="Mark AI Assistant"
                    width={28}
                    height={28}
                    className="md:w-8 md:h-8"
                  />
                )}
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-white text-sm md:text-base">
                    Mark AI Assistant
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 hidden md:block">
                    Your AI learning companion
                  </p>
                </div>
              </div>
              <button
                onClick={toggleChatbot}
                className="p-1.5 md:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <XMarkIcon className="w-4 h-4 md:w-5 md:h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="flex items-center justify-between p-2 md:p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex space-x-2">
                <button
                  onClick={handleEndChat}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="Start New Chat"
                  disabled={isInitializing || isEndingChat || !user?.userId}
                >
                  <ArrowPathIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-950 relative">
                <div className="absolute right-3 bottom-3 flex space-x-2">
                  {userInput.trim() !== "" && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={clearInput}
                      className="p-1.5 rounded-full transition-colors bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                      title="Clear input"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </motion.button>
                  )}
                </div>
                <QuestionSelector
                  userRole={userRole}
                  learnerContext={learnerContext}
                  activeQuestion={activeQuestion}
                  handleSwitchQuestion={handleSwitchQuestion}
                />

                {isInitializing ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-pulse flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700 mb-2"></div>
                      <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded w-24 mb-2"></div>
                      <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded w-32"></div>
                    </div>
                  </div>
                ) : !hasConversation ? (
                  <WelcomeMessage
                    getAccentColor={getAccentColor}
                    userRole={userRole}
                    MarkFace={MarkFace}
                    learnerContext={learnerContext}
                  />
                ) : (
                  <ChatMessages
                    messages={messages}
                    chatBubbleVariants={chatBubbleVariants}
                    getAccentColor={getAccentColor}
                    renderTypingIndicator={renderTypingIndicator}
                    onClientExecution={handleClientExecution}
                    processedMessageIds={processedClientExecutions.current}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
                <AnimatePresence>
                  {showSuggestions && (
                    <SuggestionsPanel
                      suggestions={suggestions}
                      insertSuggestion={insertSuggestion}
                      setShowSuggestions={setShowSuggestions}
                    />
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {specialActions.show && (
                    <SpecialActionUI
                      specialActions={specialActions}
                      handleIssueReport={handleIssueReport}
                      handleCreateQuestion={handleCreateQuestion}
                      handleReportPreview={handleReportPreview}
                      handleFeedback={handleFeedback}
                      handleSuggestion={handleSuggestion}
                      handleInquiry={handleInquiry}
                    />
                  )}
                </AnimatePresence>

                <div className="flex items-center space-x-2">
                  <textarea
                    ref={textareaRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Ask Mark anything..."
                    className="w-full m-0  pl-4 py-3 text-sm border dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[90px] max-h-[120px]"
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                    disabled={isInitializing}
                  />

                  <div className="relative flex-col flex-1 ">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setShowSuggestions(!showSuggestions)}
                      className="p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                      title="Show suggestions"
                      disabled={isInitializing}
                    >
                      <LightBulbIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleSendWithContext(true)}
                      className={`p-1.5 ${
                        isSendDisabled
                          ? "bg-purple-400 dark:bg-purple-900 cursor-not-allowed"
                          : "bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800"
                      } rounded-full transition-colors`}
                      title="Send message"
                      disabled={isSendDisabled}
                    >
                      <PaperAirplaneIcon className="w-4 h-4 text-white" />
                    </motion.button>
                  </div>
                </div>
                <div className="mt-2 text-center">
                  <span className="text-xs text-gray-400">
                    {getHelperText()}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReportPreviewModal
        isOpen={reportPreviewModal.isOpen}
        onClose={() =>
          setReportPreviewModal({ isOpen: false, type: "report", data: null })
        }
        reportType={reportPreviewModal.type}
        initialData={reportPreviewModal.data}
        isAuthor={userRole === "author"}
        attemptId={learnerContext.assignmentId}
        onSubmit={handleReportPreview}
      />
    </>
  );
};
