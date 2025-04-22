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
  CogIcon,
  MicrophoneIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  useAuthorContext,
  UseAuthorContextInterface,
} from "../store/useAuthorContext";
import {
  useLearnerContext,
  UseLearnerContextInterface,
} from "../store/useLearnerContext";
import { ChatRole, useMarkChatStore } from "../store/useMarkChatStore";
import { toast } from "sonner";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import { QuestionAuthorStore } from "@/config/types";

// Standard error message to display when content is empty
const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

// Suggestions Panel Component
const SuggestionsPanel = ({
  suggestions,
  insertSuggestion,
  setShowSuggestions,
}: {
  suggestions: string[];
  insertSuggestion: (suggestion: string) => void;
  setShowSuggestions: (show: boolean) => void;
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
            className="flex-shrink-0 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 rounded-full transition-colors"
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
};

// Settings Panel Component
const SettingsPanel = ({
  setShowSettings,
  isRecording,
  toggleVoiceRecognition,
  userRole,
  learnerContext,
  activeQuestion,
  handleSwitchQuestion,
  darkMode,
  setDarkMode,
}: {
  setShowSettings: (show: boolean) => void;
  isRecording: boolean;
  toggleVoiceRecognition: () => void;
  userRole: string;
  learnerContext: UseLearnerContextInterface;
  activeQuestion: number | null;
  handleSwitchQuestion: (questionId: number) => void;
  darkMode: string;
  setDarkMode: (mode: string) => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="px-4 py-3 mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm"
    >
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Chat Settings
        </h3>
        <button
          onClick={() => setShowSettings(false)}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Chat theme selector - light/dark mode */}
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
            <AdjustmentsHorizontalIcon className="w-4 h-4" />
            Theme
          </label>
          <select
            className="text-sm border border-gray-300 rounded-md p-1 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
            value={darkMode}
            onChange={(e) => setDarkMode(e.target.value)}
          >
            <option value="system">System Default</option>
            <option value="light">Light Mode</option>
            <option value="dark">Dark Mode</option>
          </select>
        </div>
      </div>
    </motion.div>
  );
};

// Context Indicators Component
const ContextIndicators = ({
  contextReady,
  userRole,
  authorContext,
  learnerContext,
  activeQuestion,
}: {
  contextReady: boolean;
  userRole: string;
  authorContext: UseAuthorContextInterface;
  learnerContext: UseLearnerContextInterface;
  activeQuestion: number | null;
}) => {
  if (!contextReady) return null;

  const commonIndicators = (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
        userRole === "author"
          ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
          : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      }`}
    >
      {userRole === "author" ? "Author Mode" : "Learner Mode"}
    </span>
  );

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

        {activeQuestion && learnerContext.questions && (
          <Tippy
            content={`Currently focused on Question ${
              learnerContext.questions.findIndex(
                (q: any) => q.id === activeQuestion,
              ) + 1
            }`}
          >
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 flex items-center gap-1 cursor-help">
              <ChatBubbleOvalLeftEllipsisIcon className="w-3 h-3" />
              {`Q${
                learnerContext.questions.findIndex(
                  (q: any) => q.id === activeQuestion,
                ) + 1
              }`}
            </span>
          </Tippy>
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

// Question Selector Component (for Learner Mode)
const QuestionSelector = ({
  userRole,
  learnerContext,
  activeQuestion,
  handleSwitchQuestion,
}: {
  userRole: string;
  learnerContext: any;
  activeQuestion: number | null;
  handleSwitchQuestion: (questionId: number) => void;
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
          <ChatBubbleOvalLeftEllipsisIcon className="w-4 h-4 text-blue-500" />
          Question Focus
        </div>
        <select
          className="text-sm border border-gray-300 rounded-md p-1 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
          value={activeQuestion || ""}
          onChange={(e) => handleSwitchQuestion(Number(e.target.value))}
        >
          {learnerContext.questions.map(
            (question: QuestionAuthorStore, index: number) => (
              <option key={question.id} value={question.id}>
                Question {index + 1}
              </option>
            ),
          )}
        </select>
      </div>
    </div>
  );
};

// Special Action UI Component
const SpecialActionUI = ({
  specialActions,
  handleRegradeRequest,
  handleIssueReport,
  handleCreateQuestion,
}: {
  specialActions: {
    show: boolean;
    type: "regrade" | "report" | "create" | null;
    data: any;
  };
  handleRegradeRequest: () => void;
  handleIssueReport: () => void;
  handleCreateQuestion: (type: string) => void;
}) => {
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
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "multiple-choice"
                  ? "bg-purple-200 text-purple-900"
                  : "bg-purple-100 text-purple-800"
              } hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 dark:text-purple-200 rounded-md transition-colors`}
            >
              Multiple Choice
            </button>
            <button
              onClick={() => handleCreateQuestion("true/false")}
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "true/false"
                  ? "bg-purple-200 text-purple-900"
                  : "bg-purple-100 text-purple-800"
              } hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 dark:text-purple-200 rounded-md transition-colors`}
            >
              True/False
            </button>
            <button
              onClick={() => handleCreateQuestion("text response")}
              className={`text-xs py-1.5 px-3 ${
                specialActions.data?.suggestedType === "text response"
                  ? "bg-purple-200 text-purple-900"
                  : "bg-purple-100 text-purple-800"
              } hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 dark:text-purple-200 rounded-md transition-colors`}
            >
              Text Response
            </button>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
};

// Welcome Message Component
const WelcomeMessage = ({
  getAccentColor,
  userRole,
  MarkFace,
  learnerContext,
}: {
  getAccentColor: () => string;
  userRole: string;
  MarkFace: any;
  learnerContext: UseLearnerContextInterface;
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
                I can explain your feedback and help request a regrade if you
                think your assessment was scored incorrectly.
              </p>
            </div>
          )}

          {!learnerContext.isGradedAssignment &&
            !learnerContext.isFeedbackMode && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-left border border-blue-200 dark:border-blue-800">
                <h4 className="text-sm font-medium text-blue-800 dark:text-blue-400 mb-2 flex items-center">
                  <AcademicCapIcon className="w-4 h-4 mr-1.5" />
                  Practice Mode
                </h4>
                <p className="text-xs text-blue-700 dark:text-blue-300">
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

// Chat Messages Component
const ChatMessages = ({
  messages,
  chatBubbleVariants,
  getAccentColor,
  renderTypingIndicator,
}: {
  messages: any[];
  chatBubbleVariants: any;
  getAccentColor: () => string;
  renderTypingIndicator: () => JSX.Element | null;
}) => {
  return (
    <>
      {messages
        .filter((msg) => msg.role !== "system")
        .map((msg, index) => {
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
    </>
  );
};

// Main MarkChat Component
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
    resetChat,
  } = useMarkChatStore();

  const learnerContext: UseLearnerContextInterface = useLearnerContext();
  const authorContext: UseAuthorContextInterface = useAuthorContext();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [darkMode, setDarkMode] = useState("light");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [specialActions, setSpecialActions] = useState<{
    show: boolean;
    type: "regrade" | "report" | "create" | null;
    data: any;
  }>({ show: false, type: null, data: null });

  const recognitionRef = useRef<any>(null);

  // Determine which context to use
  const context = userRole === "learner" ? learnerContext : authorContext;

  // Apply dark mode
  useEffect(() => {
    const setTheme = (theme: string) => {
      if (
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
      ) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };
    setTheme(darkMode);
    if (darkMode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) =>
        setTheme(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [darkMode]);

  // Setup voice recognition if available
  useEffect(() => {
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result) => result.transcript)
          .join("");
        setUserInput(transcript);
      };
      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
        toast.error("Voice recognition error. Please try again.");
      };
    }
  }, []);

  // Toggle voice recognition
  const toggleVoiceRecognition = useCallback(() => {
    if (!recognitionRef.current) {
      toast.error("Voice recognition is not supported in your browser");
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
      toast.success("Voice input stopped");
    } else {
      setUserInput("");
      recognitionRef.current.start();
      setIsRecording(true);
      toast.success("Voice input started - speak now");
    }
  }, [isRecording]);

  // Set initial context ready and active question
  useEffect(() => {
    setContextReady(true);
    if (userRole === "learner" && learnerContext.currentQuestion) {
      setActiveQuestion(learnerContext.currentQuestion.id);
    }
    setFeedbackMode(userRole === "learner" && learnerContext.isFeedbackMode);
  }, [userRole, learnerContext]);

  // Dynamic suggestions
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
          "Request a regrade for this question",
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

  // Reset chat on context change
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

  // Clear input helper
  const clearInput = useCallback(() => {
    setUserInput("");
    textareaRef.current?.focus();
  }, []);

  // Special action detection for learner
  const checkForLearnerSpecialActions = useCallback(
    (input: string) => {
      const lowerInput = input.toLowerCase();
      if (
        learnerContext.isFeedbackMode &&
        (lowerInput.includes("regrade") ||
          lowerInput.includes("wrong grade") ||
          lowerInput.includes("graded incorrectly") ||
          lowerInput.includes("review my grade") ||
          lowerInput.includes("points I deserved") ||
          lowerInput.includes("scoring issue") ||
          lowerInput.match(/score(?:.+?)wrong/) ||
          lowerInput.match(/grade(?:.+?)incorrect/))
      ) {
        setSpecialActions({
          show: true,
          type: "regrade",
          data: {
            assignmentId: learnerContext.assignmentId,
            attemptId: learnerContext.activeAttemptId,
          },
        });
      } else if (
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
        setSpecialActions({
          show: true,
          type: "report",
          data: { assignmentId: learnerContext.assignmentId },
        });
      } else {
        setSpecialActions({ show: false, type: null, data: null });
      }
    },
    [learnerContext],
  );

  // Special action detection for author
  const checkForAuthorSpecialActions = useCallback((input: string) => {
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
    } else {
      setSpecialActions({ show: false, type: null, data: null });
    }
  }, []);

  // Add context to messages and send
  const handleSendWithContext = useCallback(
    async (stream = true) => {
      if (!userInput.trim()) return;
      try {
        setHistory((prev) => [...prev, userInput]);
        setHistoryIndex(-1);
        const contextMessage = await context.getContextMessage();
        const originalMessages = [...messages];
        const messagesWithContext = [...originalMessages];
        const lastUserMsgIndex = messagesWithContext
          .map((msg, i) => (msg.role === "user" ? i : -1))
          .filter((i) => i !== -1)
          .pop();
        if (lastUserMsgIndex !== undefined) {
          messagesWithContext.splice(lastUserMsgIndex, 0, {
            ...contextMessage,
            role: contextMessage.role as ChatRole,
          });
        } else {
          const systemIndex = messagesWithContext.findIndex(
            (msg) => msg.role === "system",
          );
          const insertPosition = systemIndex !== -1 ? systemIndex + 1 : 0;
          messagesWithContext.splice(insertPosition, 0, {
            ...contextMessage,
            role: contextMessage.role as ChatRole,
          });
        }
        if (userRole === "learner") {
          checkForLearnerSpecialActions(userInput);
        } else {
          checkForAuthorSpecialActions(userInput);
        }
        useMarkChatStore.setState({ messages: messagesWithContext });
        await sendMessage(stream);
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
        sendMessage(stream);
      }
      setShowSuggestions(false);
      if (isRecording) {
        recognitionRef.current?.stop();
        setIsRecording(false);
      }
    },
    [
      userInput,
      context,
      messages,
      userRole,
      isRecording,
      sendMessage,
      checkForLearnerSpecialActions,
      checkForAuthorSpecialActions,
    ],
  );
  // Handle message history with keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  // Auto-scroll to bottom
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

  const insertSuggestion = useCallback((suggestion: string) => {
    setUserInput(suggestion);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (userInput.trim() !== "" || !isExpanded) {
      setShowSuggestions(false);
    }
  }, [userInput, isExpanded]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const handleRegradeRequest = useCallback(() => {
    const regradePrompt = `I'd like to request a regrade for assignment ${
      learnerContext.assignmentId || "this assignment"
    }. My attempt ID is ${
      learnerContext.activeAttemptId || "current attempt"
    }. I believe my answers were scored incorrectly because...`;
    setUserInput(regradePrompt);
    setSpecialActions({ show: false, type: null, data: null });
    textareaRef.current?.focus();
  }, [learnerContext]);

  const handleIssueReport = useCallback(async () => {
    try {
      const reportPrompt = `I'd like to report an issue with assignment ${
        learnerContext.assignmentId || "this assignment"
      }. The problem I'm experiencing is...`;
      setUserInput(reportPrompt);
      setSpecialActions({ show: false, type: null, data: null });
      textareaRef.current?.focus();
    } catch (error) {
      console.error("Error handling issue report:", error);
      toast.error(
        "There was a problem setting up the issue report. Please try again.",
      );
    }
  }, [learnerContext]);

  const handleCreateQuestion = useCallback((type: string) => {
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

  const handleSwitchQuestion = useCallback(
    (questionId: number) => {
      if (userRole === "learner" && learnerContext.questions) {
        const questionIndex = learnerContext.questions.findIndex(
          (q: QuestionAuthorStore) => q.id === questionId,
        );
        if (questionIndex >= 0) {
          setActiveQuestion(questionId);
          if (typeof learnerContext.setActiveQuestionNumber === "function") {
            learnerContext.setActiveQuestionNumber(questionIndex + 1);
            toast.success(`Focused on Question ${questionIndex + 1}`);
          } else {
            console.warn(
              "setActiveQuestionNumber function not available in learnerContext",
            );
            toast.info(`Focused on Question ${questionIndex + 1} (UI only)`);
          }
        }
      }
    },
    [userRole, learnerContext],
  );

  const getChatTitle = useCallback(() => {
    if (userRole === "author") return "Mark - Assignment Creator";
    if (userRole === "learner") {
      if (learnerContext.isFeedbackMode) {
        return "Mark - Feedback Coach";
      }
      return learnerContext.isGradedAssignment
        ? "Mark - Assignment Guide"
        : "Mark - Practice Coach";
    }
    return "Mark AI Assistant";
  }, [userRole, learnerContext]);

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
        : "from-blue-600 to-cyan-600";
    }
    return "from-blue-600 to-purple-600";
  }, [userRole, learnerContext]);

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
      transition: { duration: 0.2 },
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
    visible: { opacity: 1, transition: { duration: 0.3 } },
  };

  const renderTypingIndicator = useCallback(() => {
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
  }, [isTyping]);

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
              className="fixed bottom-0 right-0 w-[500px] bg-white dark:bg-gray-900 shadow-2xl rounded-t-xl border border-gray-200 dark:border-gray-700 flex flex-col z-50"
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
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title="Settings"
                  >
                    <CogIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={toggleExpanded}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDownIcon
                      className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
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

              {/* Context indicators */}
              <div className="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <ContextIndicators
                  contextReady={contextReady}
                  userRole={userRole}
                  authorContext={authorContext}
                  learnerContext={learnerContext}
                  activeQuestion={activeQuestion}
                />
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-950 relative">
                <AnimatePresence>
                  {showSettings && (
                    <SettingsPanel
                      setShowSettings={setShowSettings}
                      isRecording={isRecording}
                      toggleVoiceRecognition={toggleVoiceRecognition}
                      userRole={userRole}
                      learnerContext={learnerContext}
                      activeQuestion={activeQuestion}
                      handleSwitchQuestion={handleSwitchQuestion}
                      darkMode={darkMode}
                      setDarkMode={setDarkMode}
                    />
                  )}
                </AnimatePresence>
                <QuestionSelector
                  userRole={userRole}
                  learnerContext={learnerContext}
                  activeQuestion={activeQuestion}
                  handleSwitchQuestion={handleSwitchQuestion}
                />
                <AnimatePresence>
                  {specialActions.show && (
                    <SpecialActionUI
                      specialActions={specialActions}
                      handleRegradeRequest={handleRegradeRequest}
                      handleIssueReport={handleIssueReport}
                      handleCreateQuestion={handleCreateQuestion}
                    />
                  )}
                </AnimatePresence>
                {messages.length <= 1 ? (
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
                  />
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Action Bar */}
              <motion.div
                variants={fadeInVariants}
                className="border-t dark:border-gray-800 p-3 bg-white dark:bg-gray-900"
              >
                <AnimatePresence>
                  {showSuggestions && (
                    <SuggestionsPanel
                      suggestions={suggestions}
                      insertSuggestion={insertSuggestion}
                      setShowSuggestions={setShowSuggestions}
                    />
                  )}
                </AnimatePresence>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Ask Mark anything..."
                    className={`w-full pr-20 pl-4 py-3 text-sm border ${
                      isRecording
                        ? "border-red-400 dark:border-red-600"
                        : "dark:border-gray-700"
                    } rounded-xl bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[56px] max-h-24`}
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                  />
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
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleVoiceRecognition}
                      className={`p-1.5 rounded-full transition-colors ${
                        isRecording
                          ? "bg-red-500 text-white hover:bg-red-600"
                          : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                      }`}
                      title="Voice input"
                    >
                      <MicrophoneIcon className="w-4 h-4" />
                    </motion.button>
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
