/* eslint-disable */
"use client";

import MarkFace from "@/public/MarkFace.svg";
import {
  AcademicCapIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  PencilIcon,
  PlusCircleIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuthorContext } from "../store/useAuthorContext";
import { useLearnerContext } from "../store/useLearnerContext";
import { useMarkChatStore } from "../store/useMarkChatStore";

export const MarkChat: React.FC = () => {
  const {
    isOpen,
    toggleChat,
    messages,
    userInput,
    setUserInput,
    sendMessage,
    isTyping,
    userRole,
    setUserRole,
    resetChat,
  } = useMarkChatStore();

  // Get learner context when in learner mode
  const learnerContext = useLearnerContext();

  // Get author context when in author mode
  const authorContext = useAuthorContext();

  // Local state
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [specialActions, setSpecialActions] = useState<{
    show: boolean;
    type: "regrade" | "report" | "create" | null;
    data: any;
  }>({
    show: false,
    type: null,
    data: null,
  });

  // Determine which context to use
  const context = userRole === "learner" ? learnerContext : authorContext;

  // Set initial context ready state
  useEffect(() => {
    setContextReady(true);
  }, [userRole]);

  // Generate suggestions based on current context
  const generateSuggestions = () => {
    if (userRole === "author") {
      // Get generation capabilities
      const { canGenerateQuestions } =
        authorContext.getGenerationCapabilities();

      // Show different suggestions based on the focused question
      if (authorContext.focusedQuestionId) {
        return [
          "Improve this question",
          "Create a variant of this question",
          "Add a rubric to this question",
          "Edit the answer choices",
        ];
      } else if (canGenerateQuestions) {
        return [
          "Generate multiple-choice questions",
          "Generate text response questions",
          "Create a new question manually",
          "Improve the learning objectives",
        ];
      } else {
        return [
          "Create a new question",
          "Add learning objectives",
          "Improve the instructions",
          "Add grading criteria",
        ];
      }
    }

    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return [
          "Why did I lose points on this question?",
          "Explain the feedback for this answer",
          "I think my answer was marked incorrectly",
          "How can I improve my score next time?",
        ];
      }

      if (learnerContext.isGradedAssignment) {
        return [
          "Can you clarify the question requirements?",
          "What concepts should I understand for this?",
          "How should I approach this type of question?",
          "What does this instruction mean?",
        ];
      } else {
        // Practice mode
        return [
          "Can you explain this question?",
          "Give me a hint for this problem",
          "I'm stuck on this part",
          "What concept is this testing?",
        ];
      }
    }

    // Fallback
    return [
      "How can you help me?",
      "What can you do?",
      "I need assistance",
      "Give me some guidance",
    ];
  };

  const suggestions = generateSuggestions();

  // Reset chat when the context changes significantly
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

  // Add context to messages before sending
  const handleSendWithContext = async (stream = true) => {
    if (!userInput.trim()) return;

    try {
      // Get context message from appropriate context provider
      const contextMessage = await context.getContextMessage();

      // Add context to store temporarily (will be filtered from UI)
      const originalMessages = [...messages];

      // Find the right position to inject context
      const messagesWithContext = [...originalMessages];
      const lastUserMsgIndex = messagesWithContext
        .map((msg, i) => (msg.role === "user" ? i : -1))
        .filter((i) => i !== -1)
        .pop();

      // Insert context before the last user message if it exists
      if (lastUserMsgIndex !== undefined) {
        messagesWithContext.splice(lastUserMsgIndex, 0, contextMessage);
      } else {
        // Otherwise, add it at the beginning after system message
        const systemIndex = messagesWithContext.findIndex(
          (msg) => msg.role === "system",
        );
        const insertPosition = systemIndex !== -1 ? systemIndex + 1 : 0;
        messagesWithContext.splice(insertPosition, 0, contextMessage);
      }

      // Check for special action keywords in user input
      if (userRole === "learner") {
        checkForLearnerSpecialActions(userInput);
      } else {
        checkForAuthorSpecialActions(userInput);
      }

      // Override messages temporarily and send
      useMarkChatStore.setState({ messages: messagesWithContext });
      await sendMessage(stream);

      // Clean up context messages from display
      setTimeout(() => {
        const purified = useMarkChatStore
          .getState()
          .messages.filter(
            (msg) => msg.role !== "system" || !msg.id.includes("context"),
          );
        useMarkChatStore.setState({ messages: purified });
      }, 100);
    } catch (error) {
      console.error("Error sending message with context:", error);
      sendMessage(stream); // Fallback to regular send
    }

    setShowSuggestions(false);
  };

  // Check for learner special action keywords to show UI prompts
  const checkForLearnerSpecialActions = (input: string) => {
    const lowerInput = input.toLowerCase();

    // Check for regrade request keywords
    if (
      learnerContext.isFeedbackMode &&
      (lowerInput.includes("regrade") ||
        lowerInput.includes("wrong grade") ||
        lowerInput.includes("graded incorrectly") ||
        lowerInput.includes("review my grade"))
    ) {
      setSpecialActions({
        show: true,
        type: "regrade",
        data: {
          assignmentId: learnerContext.assignmentId,
          attemptId: learnerContext.activeAttemptId,
        },
      });
    }

    // Check for issue report keywords
    else if (
      lowerInput.includes("issue") ||
      lowerInput.includes("problem with") ||
      lowerInput.includes("bug") ||
      lowerInput.includes("doesn't work") ||
      lowerInput.includes("error")
    ) {
      setSpecialActions({
        show: true,
        type: "report",
        data: {
          assignmentId: learnerContext.assignmentId,
        },
      });
    } else {
      // Reset if no special keywords found
      setSpecialActions({
        show: false,
        type: null,
        data: null,
      });
    }
  };

  // Check for author special action keywords
  const checkForAuthorSpecialActions = (input: string) => {
    const lowerInput = input.toLowerCase();

    // Check for question creation keywords
    if (
      (lowerInput.includes("create") ||
        lowerInput.includes("add") ||
        lowerInput.includes("new")) &&
      (lowerInput.includes("question") ||
        lowerInput.includes("multiple choice") ||
        lowerInput.includes("true/false") ||
        lowerInput.includes("text"))
    ) {
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
        },
      });
    } else {
      // Reset if no special keywords found
      setSpecialActions({
        show: false,
        type: null,
        data: null,
      });
    }
  };

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Auto-focus textarea when chat opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 300);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendWithContext(true);
    }
  };

  const insertSuggestion = (suggestion: string) => {
    setUserInput(suggestion);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Handle regrade request
  const handleRegradeRequest = () => {
    const regradePrompt = `I'd like to request a regrade for assignment ${
      learnerContext.assignmentId || "this assignment"
    }. My attempt ID is ${
      learnerContext.activeAttemptId || "current attempt"
    }. I believe my answers were scored incorrectly because...`;
    setUserInput(regradePrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  };

  // Handle issue report
  const handleIssueReport = () => {
    const reportPrompt = `I'd like to report an issue with assignment ${
      learnerContext.assignmentId || "this assignment"
    }. The problem I'm experiencing is...`;
    setUserInput(reportPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  };

  // Handle create question
  const handleCreateQuestion = (type: string) => {
    const createPrompt = `I'd like to create a new ${type} question for my assignment. The question should be about...`;
    setUserInput(createPrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  };

  // Chat title based on context
  const getChatTitle = () => {
    if (userRole === "author") return "Mark - Assignment Creator (Beta)";

    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return "Mark - Feedback Coach";
      }

      return learnerContext.isGradedAssignment
        ? "Mark - Assignment Guide (Beta)"
        : "Mark - Practice Coach (Beta)";
    }

    return "Mark AI Assistant";
  };

  // Helper text based on context
  const getHelperText = () => {
    if (userRole === "author") {
      if (authorContext.focusedQuestionId) {
        return "I can help you improve this question";
      }
      return "I can help you create and manage assignments";
    }

    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return "I can explain your feedback and suggest improvements";
      }

      return learnerContext.isGradedAssignment
        ? "I'll help clarify the assignment (no direct answers)"
        : "I can provide hints and guidance for this practice";
    }

    return "I'm here to help with your educational tasks";
  };

  // Get the appropriate Accent Color
  const getAccentColor = () => {
    if (userRole === "author") return "from-purple-600 to-indigo-600";

    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) return "from-orange-600 to-amber-600";
      return learnerContext.isGradedAssignment
        ? "from-amber-600 to-yellow-600"
        : "from-blue-600 to-cyan-600";
    }

    return "from-blue-600 to-purple-600";
  };

  // Variants for framer-motion animations
  const chatWindowVariants = {
    hidden: { y: 20, opacity: 0, height: 0 },
    visible: {
      y: 0,
      opacity: 1,
      height: isExpanded ? "85vh" : "400px",
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 25,
        opacity: { duration: 0.2 },
        height: { duration: 0.3 },
      },
    },
    exit: {
      y: 20,
      opacity: 0,
      transition: {
        duration: 0.2,
      },
    },
  };

  const chatBubbleVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (i: number) => ({
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

  const fadeInVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.3,
      },
    },
  };

  // Render the typing indicator
  const renderTypingIndicator = () => {
    if (!isTyping) return null;

    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl p-3 bg-white dark:bg-gray-800 shadow-md border dark:border-gray-700">
          <div className="flex space-x-1 items-center h-6">
            <div
              className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-bounce"
              style={{ animationDelay: "600ms" }}
            />
          </div>
        </div>
      </div>
    );
  };

  // Show context indicators
  const renderContextIndicators = () => {
    if (!contextReady) return null;

    // Common indicators across roles
    const commonIndicators = (
      <>
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
            userRole === "author"
              ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          }`}
        >
          {userRole === "author" ? "Author Mode" : "Learner Mode"}
        </span>
      </>
    );

    // Role-specific indicators
    if (userRole === "learner") {
      const assignmentMeta = learnerContext.assignmentMeta;
      const attemptsRemaining = learnerContext.attemptsRemaining;

      return (
        <>
          {commonIndicators}
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              learnerContext.isFeedbackMode
                ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                : learnerContext.isGradedAssignment
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            }`}
          >
            {learnerContext.isFeedbackMode
              ? "Feedback Review"
              : learnerContext.isGradedAssignment
                ? "Graded Assignment"
                : "Practice Mode"}
          </span>

          {assignmentMeta?.name && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 truncate max-w-[120px]">
              {assignmentMeta.name}
            </span>
          )}

          {attemptsRemaining !== undefined && attemptsRemaining >= 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
              {attemptsRemaining}{" "}
              {attemptsRemaining === 1 ? "attempt" : "attempts"} left
            </span>
          )}
        </>
      );
    } else {
      // Author mode indicators
      const assignmentMeta = authorContext.assignmentMeta;

      return (
        <>
          {commonIndicators}

          {authorContext.focusedQuestionId && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
              Question Focus
            </span>
          )}

          {assignmentMeta?.name && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 truncate max-w-[120px]">
              {assignmentMeta.name}
            </span>
          )}

          {assignmentMeta?.questionCount !== undefined && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {assignmentMeta.questionCount}{" "}
              {assignmentMeta.questionCount === 1 ? "question" : "questions"}
            </span>
          )}
        </>
      );
    }
  };

  // Special action UI for regrade/issue reporting
  const renderSpecialActionUI = () => {
    if (!specialActions.show) return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="px-4 py-2 mb-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md"
      >
        {specialActions.type === "regrade" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <ArrowPathIcon className="w-5 h-5" />
              <h4 className="text-sm font-medium">Regrading Request</h4>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              It looks like you're interested in requesting a regrade for this
              assignment. I can help you submit a formal regrade request.
            </p>
            <button
              onClick={handleRegradeRequest}
              className="text-xs py-1.5 px-3 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800 text-amber-800 dark:text-amber-200 rounded-md transition-colors self-end mt-1"
            >
              Continue with regrade request
            </button>
          </div>
        ) : specialActions.type === "report" ? (
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
                className="text-xs py-1.5 px-3 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-md transition-colors"
              >
                Multiple Choice
              </button>
              <button
                onClick={() => handleCreateQuestion("true/false")}
                className="text-xs py-1.5 px-3 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-md transition-colors"
              >
                True/False
              </button>
              <button
                onClick={() => handleCreateQuestion("text response")}
                className="text-xs py-1.5 px-3 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-md transition-colors"
              >
                Text Response
              </button>
            </div>
          </div>
        ) : null}
      </motion.div>
    );
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 font-sans">
      <AnimatePresence>
        {!isOpen &&
          (MarkFace ? (
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={toggleChat}
              className={`p-2 rounded-full bg-gradient-to-br ${getAccentColor()} hover:saturate-150 text-white shadow-xl transition-all duration-200`}
            >
              <Image
                src={MarkFace}
                alt="Mark AI Assistant"
                width={50}
                height={50}
              />
            </motion.button>
          ) : (
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={toggleChat}
              className={`p-4 rounded-full bg-gradient-to-br ${getAccentColor()} hover:saturate-150 text-white shadow-xl transition-all duration-200`}
            >
              <ChatBubbleLeftRightIcon className="w-7 h-7" />
            </motion.button>
          ))}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/10 backdrop-blur-sm z-40"
              aria-hidden="true"
              onClick={toggleChat}
            />

            <motion.div
              ref={chatContainerRef}
              variants={chatWindowVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed bottom-0 right-0 w-96 bg-white dark:bg-gray-900 shadow-2xl rounded-t-xl border border-gray-200 dark:border-gray-700 flex flex-col z-50"
              role="dialog"
            >
              {/* Header */}
              <div
                className={`flex items-center justify-between p-4 bg-gradient-to-r ${getAccentColor()} rounded-t-xl text-white`}
              >
                <div className="flex items-center space-x-3">
                  <motion.div
                    whileHover={{ rotate: 15 }}
                    whileTap={{ scale: 0.9 }}
                    className="p-2 bg-white/10 rounded-full"
                  >
                    {userRole === "author" ? (
                      <PencilIcon className="w-6 h-6" />
                    ) : (
                      <SparklesIcon className="w-6 h-6" />
                    )}
                  </motion.div>
                  <div>
                    <h2 className="font-bold">{getChatTitle()}</h2>
                    <p className="text-xs opacity-80">Powered by AI</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={toggleExpanded}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDownIcon
                      className={`w-5 h-5 transition-transform duration-300 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={toggleChat}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </motion.button>
                </div>
              </div>
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-950 relative">
                {messages.length <= 1 && (
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
                        ? "Ask me about creating assignments, generating questions, or managing your content."
                        : learnerContext.isFeedbackMode
                          ? "I can explain your feedback, clarify marking, and help you understand your assessment results."
                          : learnerContext.isGradedAssignment
                            ? "I can clarify assignment requirements and guide you without providing direct answers."
                            : "I can provide hints, explanations, and help you practice effectively."}
                    </p>
                    {learnerContext.isFeedbackMode &&
                      userRole === "learner" && (
                        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg text-left">
                          <h4 className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-2 flex items-center">
                            <QuestionMarkCircleIcon className="w-4 h-4 mr-1.5" />
                            Need help with your grades?
                          </h4>
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            If you believe your assignment was graded
                            incorrectly, I can help you submit a regrade
                            request. Just ask me about regrading or tell me
                            which questions you think were scored incorrectly.
                          </p>
                        </div>
                      )}

                    {userRole === "author" &&
                      authorContext.focusedQuestionId && (
                        <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg text-left">
                          <h4 className="text-sm font-medium text-purple-800 dark:text-purple-400 mb-2 flex items-center">
                            <PencilIcon className="w-4 h-4 mr-1.5" />
                            Working on a question
                          </h4>
                          <p className="text-xs text-purple-700 dark:text-purple-300">
                            I can help you improve this question, create
                            variants, add rubrics, or modify the answer choices.
                            Just tell me what you'd like to do.
                          </p>
                        </div>
                      )}
                  </motion.div>
                )}

                {messages
                  .filter((msg) => msg.role !== "system")
                  .map((msg, index) => {
                    // Standard error message to display when content is empty
                    const STANDARD_ERROR_MESSAGE =
                      "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

                    const messageContent =
                      !msg.content || msg.content.trim() === ""
                        ? STANDARD_ERROR_MESSAGE
                        : msg.content;

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
                <div ref={messagesEndRef} />
              </div>

              {/* Action Bar */}
              <motion.div
                variants={fadeInVariants}
                className="border-t dark:border-gray-800 p-3 bg-white dark:bg-gray-900"
              >
                {/* Special Actions UI */}
                <AnimatePresence>
                  {specialActions.show && renderSpecialActionUI()}
                </AnimatePresence>

                {/* Suggestions */}
                <AnimatePresence>
                  {showSuggestions && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-2"
                    >
                      <div className="text-xs text-gray-500 mb-1.5 ml-1">
                        Suggestions:
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {suggestions.map((suggestion, index) => (
                          <motion.button
                            key={suggestion}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            onClick={() => insertSuggestion(suggestion)}
                            className="flex-shrink-0 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 rounded-full transition-colors"
                          >
                            {suggestion}
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Input Area */}
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Ask Mark anything..."
                    className="w-full pr-12 pl-4 py-3 text-sm border dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[56px] max-h-24"
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                  />

                  <div className="absolute right-3 bottom-3 flex space-x-2">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setShowSuggestions(!showSuggestions)}
                      className="p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                      title="Show suggestions"
                    >
                      <LightBulbIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleSendWithContext(true)}
                      className={`p-1.5 ${
                        !userInput.trim() || isTyping
                          ? "bg-blue-400 cursor-not-allowed"
                          : "bg-blue-600 hover:bg-blue-700"
                      } dark:bg-blue-700 dark:hover:bg-blue-800 rounded-full transition-colors`}
                      title="Send message"
                      disabled={!userInput.trim() || isTyping}
                    >
                      <PaperAirplaneIcon className="w-4 h-4 text-white" />
                    </motion.button>
                  </div>
                </div>

                {/* Attribution */}
                <div className="mt-2 text-center">
                  <span className="text-xs text-gray-400">
                    {getHelperText()}
                  </span>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
