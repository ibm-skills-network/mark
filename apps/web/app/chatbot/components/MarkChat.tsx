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
  ClockIcon,
  ArchiveBoxIcon,
  BellIcon,
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
import { useAuthorContext } from "../store/useAuthorContext";
import { useLearnerContext } from "../store/useLearnerContext";
import { ChatRole, useMarkChatStore } from "../store/useMarkChatStore";
import { toast } from "sonner";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import {
  getOrCreateTodayChat,
  getUserChats,
  getChatById,
  addMessageToChat,
  endChat,
  getUser,
} from "@/lib/shared";
import UserReportsPanel from "./UserReportsPanel";
// import { NotificationsPanel } from "./NotificationPanel";
// import { getUserNotifications, markNotificationAsRead } from "@/lib/author";

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

const ContextIndicators = ({
  contextReady,
  userRole,
  authorContext,
  learnerContext,
  activeQuestion,
  currentChatId,
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

  const chatSessionIndicator = currentChatId ? (
    <Tippy content="Active chat session">
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center gap-1">
        <ClockIcon className="w-3 h-3" />
        Chat Active
      </span>
    </Tippy>
  ) : null;

  if (userRole === "learner") {
    const assignmentMeta = learnerContext.assignmentMeta;
    const attemptsRemaining = learnerContext.attemptsRemaining;

    return (
      <>
        {commonIndicators}
        {chatSessionIndicator}
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
            learnerContext.isFeedbackMode
              ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
              : learnerContext.isGradedAssignment
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
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
                (q) => q.id === activeQuestion,
              ) + 1
            }`}
          >
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 flex items-center gap-1 cursor-help">
              <ChatBubbleOvalLeftEllipsisIcon className="w-3 h-3" />
              {`Q${
                learnerContext.questions.findIndex(
                  (q) => q.id === activeQuestion,
                ) + 1
              }`}
            </span>
          </Tippy>
        )}
      </>
    );
  } else {
    const assignmentMeta = authorContext.assignmentMeta;
    return (
      <>
        {commonIndicators}
        {chatSessionIndicator}
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
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
            {assignmentMeta.questionCount}{" "}
            {assignmentMeta.questionCount === 1 ? "question" : "questions"}
          </span>
        )}
      </>
    );
  }
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
  handleRegradeRequest,
  handleIssueReport,
  handleCreateQuestion,
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
                I can explain your feedback and help request a regrade if you
                think your assessment was scored incorrectly.
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
}) => {
  return (
    <>
      {messages
        .filter((msg) => msg.role !== "system")
        .map((msg, index) => {
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

const ChatHistoryDrawer = ({
  isOpen,
  onClose,
  chats,
  onSelectChat,
  currentChatId,
  isLoading,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 h-full w-80 bg-white dark:bg-gray-900 shadow-xl z-[999999] overflow-y-auto"
          >
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center pt-44 md:pt-36 lg:pt-36">
              <h2 className="font-bold text-lg">Chat History</h2>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2">
              {isLoading ? (
                <div className="text-center text-gray-500 dark:text-gray-400 p-4">
                  Loading chat history...
                </div>
              ) : chats.length === 0 ? (
                <div className="text-center text-gray-500 dark:text-gray-400 p-4">
                  No chat history found
                </div>
              ) : (
                <div className="space-y-2">
                  {chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => onSelectChat(chat.id)}
                      className={`w-full p-3 text-left rounded-lg transition-colors ${
                        currentChatId === chat.id
                          ? "bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800"
                          : "hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      <div className="font-medium truncate flex items-center">
                        <span className="mr-2 flex-1">
                          {chat.title ||
                            "Chat " +
                              new Date(chat.startedAt).toLocaleDateString()}
                        </span>
                        {!chat.isActive && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                            <ArchiveBoxIcon className="w-3 h-3 inline mr-1" />
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center">
                        <ClockIcon className="w-3 h-3 mr-1" />
                        {new Date(chat.lastActiveAt).toLocaleString()}
                      </div>
                      {chat.assignmentId && (
                        <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                          Assignment: {chat.assignmentId}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export const MarkChat = () => {
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

  const learnerContext = useLearnerContext();
  const authorContext = useAuthorContext();
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [darkMode, setDarkMode] = useState("light");
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [specialActions, setSpecialActions] = useState({
    show: false,
    type: null,
    data: null,
  });
  const [user, setUser] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [userChats, setUserChats] = useState([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const handleCheckReports = useCallback(() => {
    setShowReports(true);
  }, []);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationCheckInterval, setNotificationCheckInterval] =
    useState(null);

  // const loadNotifications = useCallback(async () => {
  //   if (!user?.userId) return;

  //   try {
  //     const data = await getUserNotifications();
  //     setNotifications(data);
  //     setUnreadNotifications(data.filter((n) => !n.read).length);
  //   } catch (error) {}
  // }, [user?.userId]);

  // const markNotificationRead = useCallback(async (notificationId) => {
  //   try {
  //     const success = await markNotificationAsRead(notificationId);

  //     if (success) {
  //       setNotifications((prev) =>
  //         prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
  //       );
  //       setUnreadNotifications((prev) => Math.max(0, prev - 1));
  //     }
  //   } catch (error) {}
  // }, []);
  // const handleNotificationClick = useCallback(
  //   (notification) => {
  //     try {
  //       let metadata: {
  //         issueNumber?: string;
  //         newStatus?: string;
  //       };

  //       try {
  //         metadata = JSON.parse(notification.metadata || "{}");
  //       } catch (e) {}

  //       if (notification.type === "ISSUE_STATUS_CHANGE") {
  //         setShowNotifications(false);

  //         if (!isOpen) {
  //           toggleChat();
  //         }

  //         setTimeout(() => {
  //           useMarkChatStore.getState().addMessage({
  //             id: `user-${Date.now()}`,
  //             role: "user",
  //             content: `What's the status of issue #${metadata.issueNumber || ""}?`,
  //             timestamp: new Date().toISOString(),
  //           });

  //           setTimeout(() => {
  //             useMarkChatStore.getState().addMessage({
  //               id: `assistant-${Date.now()}`,
  //               role: "assistant",
  //               content: `I see that issue #${metadata.issueNumber || ""} has been ${metadata.newStatus || "updated"}.\n\n${notification.message}\n\nWould you like to see more details about this issue?`,
  //               timestamp: new Date().toISOString(),
  //             });
  //           }, 500);
  //         }, 300);

  //         // markNotificationRead(notification.id);
  //       }
  //     } catch (error) {}
  //   },
  //   [isOpen, toggleChat, markNotificationRead],
  // );

  // useEffect(() => {
  //   if (user?.userId) {
  //     loadNotifications();

  //     if (!notificationCheckInterval) {
  //       const intervalId = setInterval(loadNotifications, 30000);
  //       setNotificationCheckInterval(intervalId);
  //     }

  //     return () => {
  //       if (notificationCheckInterval) {
  //         clearInterval(notificationCheckInterval);
  //         setNotificationCheckInterval(null);
  //       }
  //     };
  //   }
  // }, [user?.userId, loadNotifications, notificationCheckInterval]);

  // useEffect(() => {
  //   if (isOpen && user?.userId) {
  //     loadNotifications();
  //   }
  // }, [isOpen, user?.userId, loadNotifications]);
  const recognitionRef = useRef(null);
  const context = userRole === "learner" ? learnerContext : authorContext;
  const checkForIssueStatusQuery = (message: string): boolean | number => {
    const lowerMessage = message.toLowerCase();

    const generalIssuePatterns = [
      "my issues",
      "my reports",
      "reported issues",
      "issue status",
      "report status",
      "check my issues",
      "check my reports",
      "view my issues",
      "view my reports",
    ];

    const specificIssueMatch =
      lowerMessage.match(/issue #?(\d+)/i) ||
      lowerMessage.match(/report #?(\d+)/i) ||
      lowerMessage.match(/ticket #?(\d+)/i);

    if (specificIssueMatch && specificIssueMatch[1]) {
      return parseInt(specificIssueMatch[1]);
    }

    return generalIssuePatterns.some((pattern) =>
      lowerMessage.includes(pattern),
    );
  };
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await getUser();
        setUser(userData);
      } catch (error) {}
    };
    fetchUser();
  }, [userRole, learnerContext.assignmentId]);

  useEffect(() => {
    const initializeChat = async () => {
      if (!user?.userId) {
        setIsInitializing(false);
        return;
      }

      if (currentChatId) {
        setIsInitializing(false);
        return;
      }

      setIsInitializing(true);

      try {
        const assignmentId =
          userRole === "learner"
            ? learnerContext.assignmentId
            : userRole === "author"
              ? authorContext.activeAssignmentId
              : undefined;

        const todayChat = await getOrCreateTodayChat(
          user.userId,
          Number(assignmentId),
        );

        setCurrentChatId(todayChat.id);

        if (todayChat.messages && todayChat.messages.length > 0) {
          const storeMessages = todayChat.messages.map((msg) => ({
            id: `msg-${msg.id}`,
            role: msg.role.toLowerCase() as ChatRole,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
            toolCalls: msg.toolCalls,
          }));

          if (storeMessages.length > 0) {
            useMarkChatStore.setState({ messages: storeMessages });
          }
        }
      } catch (error) {
      } finally {
        setIsInitializing(false);
      }
    };

    initializeChat();
  }, [
    user?.userId,
    userRole,
    learnerContext.assignmentId,
    authorContext.activeAssignmentId,
    currentChatId,
  ]);

  useEffect(() => {
    if (shouldAutoOpen && !isOpen && !isInitializing) {
      toggleChat();
      setShouldAutoOpen(false);
    }
  }, [shouldAutoOpen, isOpen, isInitializing, toggleChat]);

  useEffect(() => {
    const setTheme = (theme) => {
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
      const handleChange = (e) => setTheme(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [darkMode]);

  useEffect(() => {
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0])
          .map((result) => result.transcript)
          .join("");
        setUserInput(transcript);
      };
      recognitionRef.current.onerror = (event) => {
        setIsRecording(false);
        toast.error("Voice recognition error. Please try again.");
      };
    }
  }, []);

  useEffect(() => {
    const loadUserChats = async () => {
      if (user?.userId && isOpen) {
        setIsLoadingChats(true);
        try {
          const chats = await getUserChats(user.userId);
          setUserChats(chats);
        } catch (error) {
        } finally {
          setIsLoadingChats(false);
        }
      }
    };

    loadUserChats();
  }, [user?.userId, isOpen]);

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

  useEffect(() => {
    setContextReady(true);
    if (userRole === "learner" && learnerContext.currentQuestion) {
      setActiveQuestion(learnerContext.currentQuestion.id);
    }
    setFeedbackMode(userRole === "learner" && learnerContext.isFeedbackMode);
  }, [userRole, learnerContext]);

  const handleSelectChat = useCallback(
    async (chatId) => {
      try {
        const chat = await getChatById(chatId);
        setCurrentChatId(chat.id);

        if (chat.messages && chat.messages.length > 0) {
          const storeMessages = chat.messages.map((msg) => ({
            id: `msg-${msg.id}`,
            role: msg.role.toLowerCase() as ChatRole,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
            toolCalls: msg.toolCalls,
          }));

          useMarkChatStore.setState({ messages: storeMessages });
        } else {
          resetChat();
        }

        setShowChatHistory(false);
        toast.success("Loaded chat session");
      } catch (error) {
        toast.error("Could not load selected chat");
      }
    },
    [resetChat],
  );

  const checkForLearnerSpecialActions = useCallback(
    (input) => {
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
    } else {
      setSpecialActions({ show: false, type: null, data: null });
    }
  }, []);

  const handleSendWithContext = useCallback(
    async (stream = true) => {
      if (!userInput.trim()) return;
      const issueCheck = checkForIssueStatusQuery(userInput);
      if (issueCheck !== false) {
        setHistory((prev) => [...prev, userInput]);
        setHistoryIndex(-1);
        useMarkChatStore.getState().addMessage({
          id: `user-${Date.now()}`,
          role: "user",
          content: userInput,
          timestamp: new Date().toISOString(),
        });
        setUserInput("");

        if (typeof issueCheck === "number") {
          const issueNumber = issueCheck;
          const relevantNotification = notifications.find((n) => {
            try {
              const metadata = JSON.parse(n.metadata || "{}");
              return metadata.issueNumber === issueNumber;
            } catch (e) {
              return false;
            }
          });

          // setTimeout(() => {
          //   if (relevantNotification) {
          //     handleNotificationClick(relevantNotification);
          //   } else {
          //     useMarkChatStore.getState().addMessage({
          //       id: `assistant-${Date.now()}`,
          //       role: "assistant",
          //       content: `I'll check the status of issue #${issueNumber} for you. Let me show you your reported issues.`,
          //       timestamp: new Date().toISOString(),
          //     });

          //     setTimeout(() => setShowReports(true), 800);
          //   }
          // }, 500);
        } else {
          setTimeout(() => {
            useMarkChatStore.getState().addMessage({
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content:
                "I'm showing your reported issues now. You can view the status of each issue and any updates from our team.",
              timestamp: new Date().toISOString(),
            });

            setTimeout(() => setShowReports(true), 800);
          }, 500);
        }
        return;
      }
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
            role: contextMessage.role,
          });
        } else {
          const systemIndex = messagesWithContext.findIndex(
            (msg) => msg.role === "system",
          );
          const insertPosition = systemIndex !== -1 ? systemIndex + 1 : 0;
          messagesWithContext.splice(insertPosition, 0, {
            ...contextMessage,
            role: contextMessage.role,
          });
        }

        if (userRole === "learner") {
          checkForLearnerSpecialActions(userInput);
        } else {
          checkForAuthorSpecialActions(userInput);
        }

        useMarkChatStore.setState({ messages: messagesWithContext });
        const browserCookies =
          typeof window !== "undefined" ? document.cookie : "";
        if (currentChatId && user?.userId) {
          try {
            await addMessageToChat(
              currentChatId,
              "USER",
              userInput,
              undefined,
              browserCookies,
            );
          } catch (error) {}
        }

        await sendMessage(stream);

        const saveAssistantMessage = async () => {
          const currentMessages = useMarkChatStore.getState().messages;
          const relevantAssistantMessages = currentMessages.filter(
            (msg) =>
              msg.role === "assistant" &&
              msg.id !== "assistant-initial" &&
              !msg.id.includes("context"),
          );

          const sortedMessages = relevantAssistantMessages.sort((a, b) => {
            const getTimestampFromId = (id) => {
              const match = id.match(/assistant-(\d+)/);
              return match ? parseInt(match[1]) : 0;
            };

            if (a.timestamp && b.timestamp) {
              return (
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime()
              );
            }

            return getTimestampFromId(b.id) - getTimestampFromId(a.id);
          });

          const assistantMessage = sortedMessages[0];

          if (assistantMessage && currentChatId && user?.userId) {
            try {
              let toolCallsData = undefined;

              if (assistantMessage.toolCalls) {
                toolCallsData = assistantMessage.toolCalls;
              } else if (typeof assistantMessage.content === "string") {
                const markerMatch = assistantMessage.content.match(
                  /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/,
                );

                if (markerMatch) {
                  try {
                    toolCallsData = JSON.parse(markerMatch[1]);
                  } catch (e) {}
                }
              }

              await addMessageToChat(
                currentChatId,
                "ASSISTANT",
                assistantMessage.content,
                toolCallsData,
              );
            } catch (error) {}
          }
        };

        const pollIntervals = [300, 500, 700, 1000, 1500, 2000, 3000];
        let pollIndex = 0;

        const pollForCompletion = async () => {
          if (!useMarkChatStore.getState().isTyping) {
            await saveAssistantMessage();
            return;
          }

          if (pollIndex < pollIntervals.length - 1) {
            pollIndex++;
          }

          setTimeout(pollForCompletion, pollIntervals[pollIndex]);
        };

        setTimeout(pollForCompletion, 200);

        setTimeout(async () => {
          if (useMarkChatStore.getState().isTyping) {
            await saveAssistantMessage();
          }
        }, 15000);

        setTimeout(() => {
          const purified = useMarkChatStore
            .getState()
            .messages.filter(
              (msg) => msg.role !== "system" || !msg.id.includes("context"),
            );
          useMarkChatStore.setState({ messages: purified });
        }, 500);
      } catch (error) {
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
      notifications,
      // handleNotificationClick,
      setShowReports,
      userRole,
      isRecording,
      sendMessage,
      checkForLearnerSpecialActions,
      checkForAuthorSpecialActions,
      currentChatId,
      user?.userId,
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
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 300);
    }
  }, [isOpen]);

  const insertSuggestion = useCallback((suggestion) => {
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

  const handleIssueReport = useCallback(() => {
    try {
      const reportPrompt = `I'd like to report an issue with assignment ${
        learnerContext.assignmentId || "this assignment"
      }. The problem I'm experiencing is...`;
      setUserInput(reportPrompt);
      setSpecialActions({ show: false, type: null, data: null });
      textareaRef.current?.focus();
    } catch (error) {
      toast.error(
        "There was a problem setting up the issue report. Please try again.",
      );
    }
  }, [learnerContext]);

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
    if (currentChatId) {
      try {
        await endChat(currentChatId);
        if (user?.userId) {
          const assignmentId =
            userRole === "learner"
              ? learnerContext.assignmentId
              : userRole === "author"
                ? authorContext.activeAssignmentId
                : undefined;

          const newChat = await getOrCreateTodayChat(
            user.userId,
            Number(assignmentId),
          );
          setCurrentChatId(newChat.id);
          resetChat();

          const updatedChats = await getUserChats(user.userId);
          setUserChats(updatedChats);

          toast.success("Started a new chat session");
        }
      } catch (error) {
        toast.error("Could not end chat session");
      }
    }
  }, [
    currentChatId,
    user?.userId,
    userRole,
    learnerContext.assignmentId,
    authorContext.activeAssignmentId,
    resetChat,
  ]);

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
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
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
                    onClick={() => setShowChatHistory(true)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title="Chat History"
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  {/* <button
                    onClick={() => setShowReports(true)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title="View Reported Issues"
                  >
                    <ExclamationTriangleIcon className="w-5 h-5" />
                  </button> */}
                  {/* <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors relative"
                    title="Notifications"
                  > */}
                  {/* <BellIcon className="w-5 h-5" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )} */}
                  {/* </button> */}
                  <button
                    onClick={handleEndChat}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    title="Start New Chat"
                    disabled={!currentChatId || isInitializing}
                  >
                    <ArrowPathIcon className="w-5 h-5" />
                  </button>
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

              <div className="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <ContextIndicators
                  contextReady={contextReady}
                  userRole={userRole}
                  authorContext={authorContext}
                  learnerContext={learnerContext}
                  activeQuestion={activeQuestion}
                  currentChatId={currentChatId}
                />
              </div>

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
                <AnimatePresence>
                  {/* {showNotifications && (
                    <NotificationsPanel
                      notifications={notifications}
                      onClose={() => setShowNotifications(false)}
                      onMarkRead={markNotificationRead}
                      onClickNotification={handleNotificationClick}
                    />
                  )} */}
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

                {isInitializing ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-pulse flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700 mb-2"></div>
                      <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded w-24 mb-2"></div>
                      <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded w-32"></div>
                    </div>
                  </div>
                ) : messages.length <= 1 ? (
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
                    } rounded-xl bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[56px] max-h-24`}
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                    disabled={isInitializing}
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
                      disabled={isInitializing}
                    >
                      <MicrophoneIcon className="w-4 h-4" />
                    </motion.button>
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
                        !userInput.trim() || isTyping || isInitializing
                          ? "bg-purple-400 cursor-not-allowed"
                          : "bg-purple-600 hover:bg-purple-700"
                      } dark:bg-purple-700 dark:hover:bg-purple-800 rounded-full transition-colors`}
                      title="Send message"
                      disabled={!userInput.trim() || isTyping || isInitializing}
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
      <ChatHistoryDrawer
        isOpen={showChatHistory}
        onClose={() => setShowChatHistory(false)}
        chats={userChats}
        onSelectChat={handleSelectChat}
        currentChatId={currentChatId}
        isLoading={isLoadingChats}
      />

      <AnimatePresence>
        {showReports && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowReports(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl m-4"
              onClick={(e) => e.stopPropagation()}
            >
              <UserReportsPanel
                userId={user?.userId || ""}
                onClose={() => setShowReports(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
