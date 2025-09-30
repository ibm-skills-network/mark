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
  ChatBubbleBottomCenterTextIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowPathIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import Draggable from "react-draggable";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuthorContext } from "../store/useAuthorContext";
import { useLearnerContext } from "../store/useLearnerContext";
import { ChatRole, useMarkChatStore } from "../store/useMarkChatStore";
import { useAuthorStore } from "@/stores/author";
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
  directUpload,
  getFileType,
} from "@/lib/shared";
import { getBaseApiPath } from "@/config/constants";
import UserReportsPanel from "./UserReportsPanel";
import ReportPreviewModal from "@/components/ReportPreviewModal";
import { useChatbot } from "../../../hooks/useChatbot";
import { useMarkSpeech } from "../../../hooks/useMarkSpeech";
import { useUserBehaviorMonitor } from "../../../hooks/useUserBehaviorMonitor";
import { useDropzone } from "react-dropzone";
import { useCallback } from "react";
import SpeechBubble from "../../../components/SpeechBubble";
import { NotificationsPanel } from "./NotificationPanel";
import { getUserNotifications, markNotificationAsRead } from "@/lib/author";
import { useNotificationSSE, type Notification } from "@/lib/notificationSSE";

interface ScreenshotDropzoneProps {
  file: File | null | undefined;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
}

const ScreenshotDropzone: React.FC<ScreenshotDropzoneProps> = ({
  file,
  onFileSelect,
  onFileRemove,
}) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: {
        "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"],
      },
      multiple: false,
      maxSize: 10 * 1024 * 1024, // 10MB
      onDropRejected: (rejectedFiles) => {
        const error = rejectedFiles[0]?.errors[0];
        if (error?.code === "file-too-large") {
          toast.error("File is too large. Maximum size is 10MB.");
        } else if (error?.code === "file-invalid-type") {
          toast.error("Invalid file type. Please select an image file.");
        } else {
          toast.error("File rejected. Please try another file.");
        }
      },
    });

  if (file) {
    return (
      <div className="flex items-center justify-between p-4 border-2 border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <svg
            className="w-4 h-4 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
            {Math.round(file.size / 1024)}KB
          </span>
        </div>
        <button
          onClick={onFileRemove}
          className="text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          Remove
        </button>
      </div>
    );
  }

  const rootProps = getRootProps();

  return (
    <div
      className={`cursor-pointer border-2 border-dashed rounded-md p-4 transition-colors hover:scale-105 transform ${
        isDragActive
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
      }`}
      {...rootProps}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center text-center">
        {isDragActive ? (
          <>
            <svg
              className="w-8 h-8 text-blue-500 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-blue-600 dark:text-blue-400 font-medium">
              Drop screenshot here
            </p>
          </>
        ) : (
          <>
            <svg
              className="w-8 h-8 text-gray-400 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Drop screenshot here or click to select
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PNG, JPG, GIF up to 10MB
            </p>
          </>
        )}
      </div>
    </div>
  );
};

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
  onClientExecution,
}) => {
  const filteredMessages = React.useMemo(
    () => messages.filter((msg) => msg.role !== "system"),
    [messages],
  );

  const [processedMessageIds, setProcessedMessageIds] = React.useState(
    new Set(),
  );

  // Handle client executions outside of the render loop
  React.useEffect(() => {
    if (onClientExecution) {
      filteredMessages.forEach((msg) => {
        // Only process messages that haven't been processed yet
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
          // Mark this message as processed
          setProcessedMessageIds((prev) => new Set(prev).add(msg.id));
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
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
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
  const { isOpen: isChatbotOpen, toggle: toggleChatbot } = useChatbot();
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

  const {
    activeBubble,
    dismiss: dismissBubble,
    sayMotionSick,
    sayExcited,
    sayProactiveHelp,
    sayIdleHelp,
    sayStuckHelp,
  } = useMarkSpeech();

  const learnerContext = useLearnerContext();
  const authorContext = useAuthorContext();

  // Get author store data
  const authorStore = useAuthorStore((state) => ({
    name: state.name,
    questions: state.questions,
    activeAssignmentId: state.activeAssignmentId,
  }));

  // Prepare context data for behavior monitoring
  const contextData = React.useMemo(() => {
    if (userRole === "author") {
      return {
        assignmentName: authorStore.name,
        questions: authorStore.questions,
        focusedQuestionId: authorContext.focusedQuestionId,
        activeAssignmentId: authorStore.activeAssignmentId,
      };
    } else if (userRole === "learner") {
      return {
        currentQuestion: learnerContext.currentQuestion,
        assignmentMeta: learnerContext.assignmentMeta,
        currentQuestionIndex:
          learnerContext.questions?.findIndex(
            (q) => q.id === learnerContext.currentQuestion?.id,
          ) + 1 || undefined,
        totalQuestions: learnerContext.questions?.length,
        isGradedAssignment: learnerContext.isGradedAssignment,
        isFeedbackMode: learnerContext.isFeedbackMode,
      };
    }
    return {};
  }, [
    userRole,
    authorStore.name,
    authorStore.questions,
    authorContext.focusedQuestionId,
    authorStore.activeAssignmentId,
    learnerContext.currentQuestion,
    learnerContext.assignmentMeta,
    learnerContext.questions,
    learnerContext.isGradedAssignment,
    learnerContext.isFeedbackMode,
  ]);

  // Behavior monitoring for proactive help
  const { behaviorData, resetHelpOffer, getChatMessage } =
    useUserBehaviorMonitor(userRole, contextData);

  // Proactive help system
  useEffect(() => {
    if (behaviorData.shouldOfferHelp && !isChatbotOpen) {
      const { helpReason, currentContext } = behaviorData;
      const subject = currentContext.detectedSubject || "general";

      switch (helpReason) {
        case "idle_too_long":
          sayIdleHelp(userRole);
          break;
        case "stuck_on_question":
          sayStuckHelp(currentContext.currentQuestionIndex, userRole);
          break;
        case "long_time_on_page":
          sayProactiveHelp(subject, userRole);
          break;
        default:
          sayProactiveHelp(subject, userRole);
      }

      // Reset help offer after showing
      setTimeout(() => resetHelpOffer(), 1000);
    }
  }, [
    behaviorData.shouldOfferHelp,
    behaviorData.helpReason,
    behaviorData.currentContext,
    isChatbotOpen,
    userRole,
    sayIdleHelp,
    sayStuckHelp,
    sayProactiveHelp,
    resetHelpOffer,
  ]);

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
  const [dismissedActions, setDismissedActions] = useState(new Set());

  const generateActionKey = useCallback((type, context) => {
    const baseKey = `${type}-${context.assignmentId || 'general'}`;
    return baseKey;
  }, []);

  const dismissAction = useCallback((type, context) => {
    const key = generateActionKey(type, context);
    setDismissedActions(prev => {
      const newSet = new Set(prev);
      newSet.add(key);
      return newSet;
    });
    setSpecialActions({ show: false, type: null, data: null });
  }, [generateActionKey]);

  const [user, setUser] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [userChats, setUserChats] = useState([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [reportPreviewModal, setReportPreviewModal] = useState({
    isOpen: false,
    type: "report" as "report" | "feedback" | "suggestion" | "inquiry",
    data: null as any,
  });
  const handleCheckReports = useCallback(() => {
    setShowReports(true);
  }, []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [notificationCheckInterval, setNotificationCheckInterval] =
    useState<NodeJS.Timeout | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [currentPosition, setCurrentPosition] = useState({ x: 0, y: 0 }); // Real-time position during drag
  const [isDragging, setIsDragging] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });
  const [dragStartTime, setDragStartTime] = useState(0);
  const [touchStartTime, setTouchStartTime] = useState(0);
  const [touchStartPosition, setTouchStartPosition] = useState({ x: 0, y: 0 });
  const [isTouching, setIsTouching] = useState(false);

  const isMobileDevice = useCallback(() => {
    return typeof window !== 'undefined' && (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.innerWidth < 768
    );
  }, []);

  // Motion sickness tracking
  const [motionData, setMotionData] = useState({
    dragCount: 0,
    dragStartTime: 0,
    lastPosition: { x: 0, y: 0 },
    totalDistance: 0,
    lastMotionSickTime: 0,
    continuousDragTime: 0,
  });

  // Helper function to constrain position to viewport
  const constrainToViewport = useCallback((position) => {
    if (typeof window === "undefined") return position;

    const padding = 10;
    const buttonSize = 66;

    return {
      x: Math.max(
        padding,
        Math.min(position.x, window.innerWidth - buttonSize - padding),
      ),
      y: Math.max(
        padding,
        Math.min(position.y, window.innerHeight - buttonSize - padding),
      ),
    };
  }, []);

  // Load saved position on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mark-chat-position");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const constrainedPos = constrainToViewport(parsed);
          setDragPosition(constrainedPos);
          setCurrentPosition(constrainedPos);
        } catch (e) {
          // Default to bottom-right if parsing fails
          const defaultPos = constrainToViewport({
            x: window.innerWidth - 80,
            y: window.innerHeight - 80,
          });
          setDragPosition(defaultPos);
          setCurrentPosition(defaultPos);
        }
      } else {
        // Default position: very bottom-right
        const defaultPos = constrainToViewport({
          x: window.innerWidth - 80,
          y: window.innerHeight - 80,
        });
        setDragPosition(defaultPos);
        setCurrentPosition(defaultPos);
      }
    }
  }, [constrainToViewport]);

  // Handle window resize to keep chatbot in bounds
  useEffect(() => {
    const handleResize = () => {
      setDragPosition((prev) => constrainToViewport(prev));
      setCurrentPosition((prev) => constrainToViewport(prev));
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, [constrainToViewport]);

  const handleDragStart = useCallback((e, data) => {
    setHasMoved(false);
    setIsDragging(false); // Reset dragging state
    setDragStartPosition({ x: data.x, y: data.y });
    setDragStartTime(Date.now());
    setMotionData((prev) => ({
      ...prev,
      dragCount: prev.dragCount + 1,
      dragStartTime: Date.now(),
      lastPosition: dragPosition,
      totalDistance: 0,
    }));
  }, [dragPosition]);

  const handleDrag = useCallback(
    (e, data) => {
      // Calculate distance from start position
      const distanceFromStart = Math.sqrt(
        Math.pow(data.x - dragStartPosition.x, 2) +
        Math.pow(data.y - dragStartPosition.y, 2)
      );

      // Calculate time elapsed since drag start
      const timeElapsed = Date.now() - dragStartTime;

      const MOBILE_DRAG_THRESHOLD = 25;
      const DESKTOP_DRAG_THRESHOLD = 5;
      const MIN_DRAG_TIME = 200;

      const dragThreshold = isMobileDevice() ? MOBILE_DRAG_THRESHOLD : DESKTOP_DRAG_THRESHOLD;

      if (!hasMoved && distanceFromStart > dragThreshold && timeElapsed > MIN_DRAG_TIME) {
        setHasMoved(true);
        setIsDragging(true);
      }

      // Update real-time position for speech bubble
      setCurrentPosition({ x: data.x, y: data.y });

      // Calculate distance moved
      setMotionData((prev) => {
        const distance = Math.sqrt(
          Math.pow(data.x - prev.lastPosition.x, 2) +
            Math.pow(data.y - prev.lastPosition.y, 2),
        );
        const newTotalDistance = prev.totalDistance + distance;
        const currentTime = Date.now();
        const dragDuration = currentTime - prev.dragStartTime;

        // Check for motion sickness conditions (much more lenient)
        const shouldGetSick =
          // Dragged for more than 5 seconds continuously (increased from 2)
          dragDuration > 5000 ||
          // Moved more than 500 pixels total in this drag (increased from 300)
          newTotalDistance > 500 ||
          // Been dragged more than 6 times in 30 seconds (more lenient)
          (prev.dragCount > 6 &&
            currentTime - prev.lastMotionSickTime < 30000) ||
          // Very fast movement - only if extremely fast (increased threshold)
          (dragDuration > 1000 && newTotalDistance / dragDuration > 1.0);

        // Much longer cooldown period: 15 seconds between complaints (increased from 5)
        // Also add random chance: only 30% chance to complain even if conditions are met
        if (
          shouldGetSick &&
          currentTime - prev.lastMotionSickTime > 15000 &&
          Math.random() < 0.3
        ) {
          sayMotionSick();
          return {
            ...prev,
            totalDistance: newTotalDistance,
            lastPosition: { x: data.x, y: data.y },
            lastMotionSickTime: currentTime,
          };
        }

        return {
          ...prev,
          totalDistance: newTotalDistance,
          lastPosition: { x: data.x, y: data.y },
        };
      });
    },
    [hasMoved, sayMotionSick, dragStartPosition, dragStartTime, isMobileDevice],
  );

  const handleDragStop = useCallback(
    (e, data) => {
      if (hasMoved) {
        // Constrain position to viewport bounds with some padding
        const padding = 10;
        const buttonSize = 66; // Approximate size of the button

        const constrainedPosition = {
          x: Math.max(
            padding,
            Math.min(data.x, window.innerWidth - buttonSize - padding),
          ),
          y: Math.max(
            padding,
            Math.min(data.y, window.innerHeight - buttonSize - padding),
          ),
        };

        // Check if position should be docked to edges
        const dockThreshold = 50; // Distance from edge to trigger docking
        const dockedPosition = { ...constrainedPosition };
        let docked = false;

        // Dock to left edge
        if (constrainedPosition.x < dockThreshold) {
          dockedPosition.x = padding;
          docked = true;
        }
        // Dock to right edge
        else if (
          constrainedPosition.x >
          window.innerWidth - buttonSize - dockThreshold
        ) {
          dockedPosition.x = window.innerWidth - buttonSize - padding;
          docked = true;
        }

        // Dock to top edge
        if (constrainedPosition.y < dockThreshold) {
          dockedPosition.y = padding;
          docked = true;
        }
        // Dock to bottom edge
        else if (
          constrainedPosition.y >
          window.innerHeight - buttonSize - dockThreshold
        ) {
          dockedPosition.y = window.innerHeight - buttonSize - padding;
          docked = true;
        }

        setIsDocked(docked);

        setDragPosition(dockedPosition);
        setCurrentPosition(dockedPosition); // Keep positions in sync
        if (typeof window !== "undefined") {
          localStorage.setItem(
            "mark-chat-position",
            JSON.stringify(dockedPosition),
          );
        }

        // Rarely say something excited about the new position (reduced from 30% to 10%)
        if (Math.random() < 0.1) {
          setTimeout(() => sayExcited(), 800); // Also increased delay
        }
      }

      // Reset states
      setTimeout(() => {
        setIsDragging(false);
        setHasMoved(false);
      }, 50);
    },
    [hasMoved, sayExcited],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobileDevice()) return;

    const touch = e.touches[0];
    setIsTouching(true);
    setTouchStartTime(Date.now());
    setTouchStartPosition({ x: touch.clientX, y: touch.clientY });
  }, [isMobileDevice]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isMobileDevice() || !isTouching) return;

    const touch = e.touches[0];
    const distanceMoved = Math.sqrt(
      Math.pow(touch.clientX - touchStartPosition.x, 2) +
      Math.pow(touch.clientY - touchStartPosition.y, 2)
    );

    if (distanceMoved > 20) {
      setIsTouching(false);
    }
  }, [isMobileDevice, isTouching, touchStartPosition]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isMobileDevice() || !isTouching) return;

    const touchDuration = Date.now() - touchStartTime;
    const isQuickTap = touchDuration < 200;

    if (isQuickTap && !isDragging && !hasMoved) {
      e.preventDefault();
      e.stopPropagation();

      if (behaviorData.shouldOfferHelp || behaviorData.helpReason) {
        const helpMessage = getChatMessage();
        setUserInput(helpMessage);
        dismissBubble();
        resetHelpOffer();
      }
      toggleChatbot();
    }

    setIsTouching(false);
  }, [
    isMobileDevice,
    isTouching,
    touchStartTime,
    isDragging,
    hasMoved,
    behaviorData.shouldOfferHelp,
    behaviorData.helpReason,
    getChatMessage,
    setUserInput,
    dismissBubble,
    resetHelpOffer,
    toggleChatbot,
  ]);

  const handleChatToggle = useCallback(() => {
    let shouldToggle: boolean;

    if (isMobileDevice()) {
      const tapDuration = Date.now() - dragStartTime;
      const isQuickTap = tapDuration < 300;
      shouldToggle = isQuickTap || !isDragging;
    } else {
      shouldToggle = !isDragging;
    }

    if (shouldToggle) {
      if (behaviorData.shouldOfferHelp || behaviorData.helpReason) {
        const helpMessage = getChatMessage();
        setUserInput(helpMessage);
        dismissBubble();
        resetHelpOffer();
      }
      toggleChatbot();
    }
  }, [
    isDragging,
    isMobileDevice,
    dragStartTime,
    toggleChatbot,
    behaviorData.shouldOfferHelp,
    behaviorData.helpReason,
    getChatMessage,
    setUserInput,
    dismissBubble,
    resetHelpOffer,
  ]);

  // SSE setup for real-time notifications
  const notificationSSE = useNotificationSSE({
    onInitial: (initialNotifications) => {
      setNotifications(initialNotifications);
      setUnreadNotifications(
        initialNotifications.filter((n) => !n.read).length,
      );
    },
    onNew: (notification) => {
      setNotifications((prev) => [notification, ...prev]);
      if (!notification.read) {
        setUnreadNotifications((prev) => prev + 1);
      }
    },
    onRead: (notificationId) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
      setUnreadNotifications((prev) => Math.max(0, prev - 1));
    },
    onConnect: () => {
      setSseConnected(true);
    },
    onDisconnect: () => {
      setSseConnected(false);
    },
    onError: (error) => {
      console.error("Notification SSE error:", error);
      setSseConnected(false);
      // Fallback to polling if SSE fails
      loadNotificationsFallback();
    },
  });

  // Fallback function for when SSE fails
  const loadNotificationsFallback = useCallback(async () => {
    if (!user?.userId) return;

    try {
      const data = await getUserNotifications();
      setNotifications(data);
      setUnreadNotifications(data.filter((n) => !n.read).length);
    } catch (error) {}
  }, [user?.userId]);

  // Alias for backward compatibility (use SSE primarily, fallback when needed)
  const loadNotifications = loadNotificationsFallback;

  const markNotificationRead = useCallback(async (notificationId) => {
    try {
      const success = await markNotificationAsRead(notificationId);

      if (success) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
        );
        setUnreadNotifications((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {}
  }, []);
  const handleNotificationClick = useCallback(
    (notification) => {
      try {
        let metadata: {
          issueNumber?: string;
          newStatus?: string;
        };

        try {
          metadata = JSON.parse(notification.metadata || "{}");
        } catch (e) {}

        if (notification.type === "ISSUE_STATUS_CHANGE") {
          setShowNotifications(false);

          if (!isOpen) {
            toggleChat();
          }

          setTimeout(() => {
            useMarkChatStore.getState().addMessage({
              id: `user-${Date.now()}`,
              role: "user",
              content: `What's the status of issue #${metadata.issueNumber || ""}?`,
              timestamp: new Date().toISOString(),
            });

            setTimeout(() => {
              useMarkChatStore.getState().addMessage({
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: `I see that issue #${metadata.issueNumber || ""} has been ${metadata.newStatus || "updated"}.\n\n${notification.message}\n\nWould you like to see more details about this issue?`,
                timestamp: new Date().toISOString(),
              });
            }, 500);
          }, 300);

          // markNotificationRead(notification.id);
        }
      } catch (error) {}
    },
    [isOpen, toggleChat, markNotificationRead],
  );

  useEffect(() => {
    if (user?.userId) {
      // Connect to SSE for real-time notifications
      notificationSSE.connect();

      // Load initial notifications as fallback
      loadNotifications();

      return () => {
        // Disconnect SSE when component unmounts or user changes
        notificationSSE.disconnect();
      };
    }
  }, [user?.userId, loadNotifications]);

  useEffect(() => {
    if (isOpen && user?.userId && !sseConnected) {
      // Only load notifications manually if SSE is not connected
      loadNotifications();
    }
  }, [isOpen, user?.userId, loadNotifications, sseConnected]);
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
        const actionKey = generateActionKey("regrade", { assignmentId: learnerContext.assignmentId });
        if (!dismissedActions.has(actionKey)) {
          setSpecialActions({
            show: true,
            type: "regrade",
            data: {
              assignmentId: learnerContext.assignmentId,
              attemptId: learnerContext.activeAttemptId,
            },
          });
        }
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
        const actionKey = generateActionKey("report", { assignmentId: learnerContext.assignmentId });
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

          setTimeout(() => {
            if (relevantNotification) {
              handleNotificationClick(relevantNotification);
            } else {
              useMarkChatStore.getState().addMessage({
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: `I'll check the status of issue #${issueNumber} for you. Let me show you your reported issues.`,
                timestamp: new Date().toISOString(),
              });

              setTimeout(() => setShowReports(true), 800);
            }
          }, 500);
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
        // When user cancels, dismiss the action so it doesn't reappear
        const actionData = specialActions.data || {};
        dismissAction(specialActions.type, { assignmentId: actionData.assignmentId });
        return;
      }

      if (action === "submit") {
        // Submit the actual report with screenshot in a single request
        try {
          const reportData = value || specialActions.data;

          // Create FormData for multipart request
          const formData = new FormData();
          formData.append("issueType", reportData.issueType);
          formData.append("description", reportData.description);
          formData.append("severity", reportData.severity || "info");
          formData.append("category", reportData.category || "Issue Report");
          formData.append("userRole", reportData.userRole || "learner");
          formData.append(
            "assignmentId",
            reportData.assignmentId?.toString() ??
              learnerContext?.assignmentId?.toString() ??
              authorContext?.activeAssignmentId?.toString() ??
              "0",
          );

          // Add screenshot file if present
          if (reportData.screenshot) {
            formData.append("screenshot", reportData.screenshot);
            toast.info("Submitting report with screenshot...");
          } else {
            toast.info("Submitting report...");
          }

          // Submit everything in one request
          const response = await fetch(`${getBaseApiPath("v1")}/reports`, {
            method: "POST",
            headers: {
              Cookie: document.cookie,
            },
            credentials: "include", // pragma: allowlist secret
            body: formData,
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(
              errorBody.message || `HTTP error ${response.status}`,
            );
          }

          const res = await response.json();

          // Show result in chat
          const resultMessage =
            res?.content || "Report submitted successfully!";
          useMarkChatStore.getState().addMessage({
            id: Date.now().toString(),
            role: "assistant",
            content: resultMessage,
            timestamp: new Date().toISOString(),
          });

          // Dismiss the action so it doesn't reappear after successful submission
          dismissAction("report", { assignmentId: reportData.assignmentId });
          setReportPreviewModal({ isOpen: false, type: "report", data: null });

          if (reportData.screenshot) {
            toast.success(
              "Issue report with screenshot submitted successfully!",
            );
          } else {
            toast.success("Issue report submitted successfully!");
          }
        } catch (error) {
          console.error("Error submitting report:", error);
          toast.error("Failed to submit report. Please try again.");
        }
        return;
      }

      // Handle field updates including file upload
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

  const handleClientExecution = useCallback((toolCall) => {
    if (toolCall.function === "showReportPreview") {
      // Open the report preview modal instead of inline form
      setReportPreviewModal({
        isOpen: true,
        type: toolCall.params.type || "report",
        data: toolCall.params,
      });
    }
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
    <>
      {/* Mark's Speech Bubble */}
      <SpeechBubble
        bubble={activeBubble}
        onDismiss={dismissBubble}
        position={currentPosition}
      />

      {/* Floating toggle button when panel is closed */}
      <AnimatePresence>
        {!isChatbotOpen && (
          <Draggable
            position={dragPosition}
            onStart={handleDragStart}
            onDrag={handleDrag}
            onStop={handleDragStop}
            bounds={{
              left: 10,
              top: 10,
              right:
                typeof window !== "undefined" ? window.innerWidth - 76 : 800,
              bottom:
                typeof window !== "undefined" ? window.innerHeight - 76 : 600,
            }}
          >
            <div className="fixed z-50">
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleChatToggle}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`p-3 rounded-full bg-gradient-to-br ${getAccentColor()} hover:saturate-150 text-white shadow-xl transition-all duration-200 ${isMobileDevice() ? 'cursor-pointer' : 'cursor-move'} ${isDocked ? "ring-2 ring-blue-400 ring-opacity-75" : ""}`}
              >
                {MarkFace ? (
                  <Image
                    src={MarkFace}
                    alt="Mark AI Assistant"
                    width={50}
                    height={50}
                    draggable={false}
                    className="pointer-events-none select-none"
                  />
                ) : (
                  <ChatBubbleLeftRightIcon className="w-7 h-7 pointer-events-none" />
                )}
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                )}
              </motion.button>
            </div>
          </Draggable>
        )}
      </AnimatePresence>

      {/* Side panel */}
      <AnimatePresence>
        {isChatbotOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width: typeof window !== "undefined" && window.innerWidth < 768 ? "100vw" : "25vw",
              opacity: 1
            }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
            className="h-full bg-white dark:bg-gray-900 shadow-2xl border-l md:border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden font-sans relative z-[9999]"
          >
            {/* Header */}
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

            {/* Action buttons bar */}
            <div className="flex items-center justify-between p-2 md:p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex space-x-2">
                <button
                  onClick={() => setShowChatHistory(true)}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="Chat History"
                >
                  <ClockIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={handleEndChat}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="Start New Chat"
                  disabled={!currentChatId || isInitializing}
                >
                  <ArrowPathIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title="Settings"
                >
                  <CogIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors relative"
                  title="Notifications"
                >
                  <BellIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {unreadNotifications > 9 ? "9+" : unreadNotifications}
                    </span>
                  )}
                </button>
                {/* handleCheckReports */}
              </div>
              <button
                onClick={handleCheckReports}
                className="p-2 mr-2 rounded-sm transition-colors bg-white dark:bg-gray-800 hover:bg-purple-100 dark:hover:bg-purple-900 border border-gray-300 dark:border-gray-700 shadow-sm"
                title="Check Reports"
              >
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  Your Reports
                </span>
              </button>
            </div>

            {/* Chat content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Settings panel */}
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
                {showNotifications && (
                  <NotificationsPanel
                    notifications={notifications}
                    onMarkRead={markNotificationRead}
                    onClickNotification={(notification) => {
                      markNotificationRead(notification.id);
                      setShowNotifications(false);
                    }}
                    onClose={() => setShowNotifications(false)}
                  />
                )}
              </AnimatePresence>

              {/* Messages area */}
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
                    onClientExecution={handleClientExecution}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
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

                {/* Report Preview Form - positioned right above input */}
                <AnimatePresence>
                  {specialActions.show && (
                    <SpecialActionUI
                      specialActions={specialActions}
                      handleRegradeRequest={handleRegradeRequest}
                      handleIssueReport={handleIssueReport}
                      handleCreateQuestion={handleCreateQuestion}
                      handleReportPreview={handleReportPreview}
                      handleFeedback={handleFeedback}
                      handleSuggestion={handleSuggestion}
                      handleInquiry={handleInquiry}
                    />
                  )}
                </AnimatePresence>

                <div className=" flex items-center space-x-2">
                  <textarea
                    ref={textareaRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Ask Mark anything..."
                    className={`w-full m-0  pl-4 py-3 text-sm border ${
                      isRecording
                        ? "border-red-400 dark:border-red-600"
                        : "dark:border-gray-700"
                    } rounded-xl bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[90px] max-h-[120px]`}
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                    disabled={isInitializing}
                  />
                  <div className="relative flex-col flex-1 ">
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
              </div>
            </div>
          </motion.div>
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

      {showReports && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={() => setShowReports(false)}
        >
          <div
            className="w-full max-w-6xl m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <UserReportsPanel
              userId={user?.userId || ""}
              onClose={() => setShowReports(false)}
            />
          </div>
        </div>
      )}

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
