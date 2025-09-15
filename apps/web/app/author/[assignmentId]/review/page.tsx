/*eslint-disable*/
"use client";
import MarkdownViewer from "@/components/MarkdownViewer";
import Title from "@/components/Title";
import { extractAssignmentId } from "@/lib/strings";
import {
  PencilSquareIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { usePathname, useRouter } from "next/navigation";
import React, { useState, useMemo } from "react";
import { useAssignmentConfig } from "../../../../stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "../../../../stores/assignmentFeedbackConfig";
import { useAuthorStore } from "../../../../stores/author";
import Question from "../../(components)/AuthorQuestionsPage/Question";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import { useQuestionsAreReadyToBePublished } from "@/app/Helpers/checkQuestionsReady";
import { cn } from "@/lib/strings";
import {
  ArrowRightIcon,
  PencilIcon,
  StarIcon,
  DocumentArrowDownIcon,
  DocumentArrowUpIcon,
  XMarkIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/solid";
import { QuestionAuthorStore } from "@/config/types";
import ExportModal, { ExportOptions } from "../../(components)/ExportModal";

// Helper function to determine if a validation error is question-related
const isQuestionRelatedValidationError = (message: string): boolean => {
  const questionRelatedErrors = [
    "question",
    "rubric",
    "choice",
    "variant",
    "description",
    "text",
  ];
  const hasQuestionIssue = questionRelatedErrors.some((error) =>
    message.toLowerCase().includes(error.toLowerCase()),
  );
  return hasQuestionIssue;
};

// Issues Modal Component
const IssuesModal = ({
  isOpen,
  onClose,
  questionIssues,
  questions,
  isValid,
  message,
  invalidQuestionId,
  onNavigateToFix,
  onAutoFix,
  onNavigateToConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  questionIssues: Record<number, string[]>;
  questions: QuestionAuthorStore[];
  isValid: boolean;
  message: string;
  invalidQuestionId: number | null;
  onNavigateToFix: (questionId: number) => void;
  onAutoFix: (questionId: number, issue: string) => void;
  onNavigateToConfig: () => void;
}) => {
  if (!isOpen) return null;

  const totalIssues = Object.keys(questionIssues).length;
  const hasValidationError = !isValid && message;
  const totalAllIssues = totalIssues + (hasValidationError ? 1 : 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
            <h2 className="text-lg font-semibold text-gray-900">
              Issues Found ({totalAllIssues} total)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Show configuration error only if it's not a question-specific issue */}
          {!isValid &&
            message &&
            !isQuestionRelatedValidationError(message) && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-red-900 mb-1">
                        Configuration Error
                      </h3>
                      <p className="text-sm text-red-700">{message}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToConfig();
                    }}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors flex-shrink-0 ml-4"
                  >
                    Go to Config
                    <ArrowRightIcon className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

          {/* Show note about question-related validation errors */}
          {!isValid &&
            message &&
            Object.keys(questionIssues).length > 0 &&
            isQuestionRelatedValidationError(message) && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <InformationCircleIcon className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-blue-900 mb-1">Note</h3>
                    <p className="text-sm text-blue-700">
                      The validation system also detected this issue, but it's
                      shown below as a question-specific issue with fix options.
                    </p>
                  </div>
                </div>
              </div>
            )}

          <div className="space-y-4">
            {Object.entries(questionIssues).map(([questionId, issues]) => {
              const question = questions.find(
                (q) => q.id === parseInt(questionId),
              );
              const questionIndex =
                questions.findIndex((q) => q.id === parseInt(questionId)) + 1;

              return (
                <div
                  key={questionId}
                  className="border border-red-200 rounded-lg p-4 bg-red-50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-red-900">
                      Question {questionIndex}:{" "}
                      <MarkdownViewer>
                        {question?.question || "Untitled Question"}
                      </MarkdownViewer>
                    </h3>
                    <button
                      onClick={() => onNavigateToFix(parseInt(questionId))}
                      className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                    >
                      Go to Fix
                      <ArrowRightIcon className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {issues.map((issue, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-white rounded border border-red-200"
                      >
                        <div className="flex items-start gap-2">
                          <ExclamationTriangleIcon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <span className="text-sm text-red-700">{issue}</span>
                        </div>

                        {/* Auto-fix button for fixable issues */}
                        {canAutoFix(issue) && (
                          <button
                            onClick={() =>
                              onAutoFix(parseInt(questionId), issue)
                            }
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                            title="Automatically fix this issue"
                          >
                            <WrenchScrewdriverIcon className="w-3 h-3" />
                            Auto Fix
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Fix these issues to ensure your assignment works properly for
              learners.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to determine if an issue can be auto-fixed
const canAutoFix = (issue: string): boolean => {
  const autoFixableIssues = [
    "Question type not selected",
    "Question title is empty",
    "No choices added",
    "No rubrics defined",
    "has no criteria defined",
    "description is empty",
    "question is empty",
  ];
  return autoFixableIssues.some((fixable) => issue.includes(fixable));
};

// Component to show before/after comparison
const ChangeComparison = ({
  label,
  before,
  after,
  type = "text",
  onNavigate, // Added this prop
}: {
  label: string;
  before: unknown;
  after: unknown;
  type?: "text" | "markdown" | "boolean" | "number" | "questionOrder";
  onNavigate?: () => void; // Added this type
}) => {
  const hasChanged = JSON.stringify(before) !== JSON.stringify(after);

  if (!hasChanged) return null;

  const renderValue = (value: any, isOld = false) => {
    if (value === null || value === undefined || value === "") {
      return <span className="text-gray-400 italic">Not set</span>;
    }

    if (type === "boolean") {
      return (
        <span
          className={cn(
            "font-medium",
            isOld ? "text-red-700" : "text-green-700",
          )}
        >
          {value ? "Yes" : "No"}
        </span>
      );
    }

    if (type === "markdown") {
      const cleanValue = value.replace(/<\/?[^>]+(>|$)/g, "").trim();
      if (cleanValue === "" || cleanValue === "Not set") {
        return <span className="text-gray-400 italic">Not set</span>;
      }
      return (
        <div
          className={cn("rounded-md p-3", isOld ? "bg-red-50" : "bg-green-50")}
        >
          <MarkdownViewer
            className={cn("text-sm", isOld ? "text-red-900" : "text-green-900")}
          >
            {value}
          </MarkdownViewer>
        </div>
      );
    }

    return (
      <span
        className={cn("font-medium", isOld ? "text-red-700" : "text-green-700")}
      >
        {String(value)}
      </span>
    );
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h6 className="text-sm font-medium text-gray-600">{label}</h6>
        {onNavigate && ( // Added navigation button
          <button
            onClick={onNavigate}
            className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
          >
            Go to section
            <ArrowRightIcon className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <MinusIcon className="w-4 h-4 text-red-500" />
          <span className="text-xs font-medium text-red-600">Before</span>
        </div>
        <div
          className={cn(
            "p-3 rounded-md border",
            type === "markdown"
              ? "bg-red-50/50 border-red-200"
              : "bg-red-50 border-red-200",
          )}
        >
          {renderValue(before, true)}
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <PlusIcon className="w-4 h-4 text-green-500" />
          <span className="text-xs font-medium text-green-600">After</span>
        </div>
        <div
          className={cn(
            "p-3 rounded-md border",
            type === "markdown"
              ? "bg-green-50/50 border-green-200"
              : "bg-green-50 border-green-200",
          )}
        >
          {renderValue(after, false)}
        </div>
      </div>
    </div>
  );
};

// Section component for changes mode
const ChangesSection = ({
  title,
  link,
  changes,
}: {
  title: string;
  link?: string;
  changes: React.ReactNode;
}) => {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-purple-200 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between w-full mb-4">
        <div className="flex items-center gap-2">
          <h4 className="text-grey-900 text-xl">{title}</h4>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
            <PencilIcon className="w-3 h-3" />
            Modified
          </span>
        </div>
        {link && (
          <button
            onClick={() => router.push(link)}
            className="hover:bg-gray-100 p-2 rounded-md"
          >
            <PencilSquareIcon className="h-6 w-6 text-gray-500" />
          </button>
        )}
      </div>
      {changes}
    </div>
  );
};

// Original Section component for full view
const Section = ({
  title,
  content,
  link,
  hasChanges = false,
  isValid = true,
  errorMessage = "",
}: {
  title: string;
  content: string;
  link?: string;
  hasChanges?: boolean;
  isValid?: boolean;
  errorMessage?: string;
}) => {
  const router = useRouter();

  return (
    <div
      className={cn(
        "flex flex-col gap-y-4 px-8 py-6 bg-white rounded border shadow-sm hover:shadow-md transition-all",
        hasChanges && "border-purple-300 bg-white",
        !isValid && "border-red-300 bg-red-50/30",
        isValid && !hasChanges && "border-gray-200",
      )}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <h4 className="text-grey-900 text-xl">{title}</h4>
          {hasChanges && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
              <PencilIcon className="w-3 h-3" />
              Modified
            </span>
          )}
          {!isValid && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-full">
              <ExclamationTriangleIcon className="w-3 h-3" />
              Error
            </span>
          )}
        </div>
        {link && (
          <button
            onClick={() => router.push(link)}
            className="hover:bg-gray-100 p-2 rounded-md"
          >
            <PencilSquareIcon className="h-6 w-6 text-gray-500" />
          </button>
        )}
      </div>
      {!isValid && errorMessage && (
        <div className="text-sm text-red-600 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {errorMessage}
        </div>
      )}
      <MarkdownViewer className="text-gray-600">
        {content
          ? content.replace(/<\/?[^>]+(>|$)/g, "").trim() === ""
            ? "Not set"
            : content
          : "Not set"}
      </MarkdownViewer>
    </div>
  );
};

// Component to show question changes
const QuestionChanges = ({
  originalQuestion,
  currentQuestion,
  index,
  changeDetails,
  onNavigateToQuestion,
}: {
  originalQuestion: any;
  currentQuestion: any;
  index: number;
  changeDetails: string[];
  onNavigateToQuestion: () => void;
}) => {
  const changes = [];

  // Check for title changes
  if (changeDetails.some((d) => d.includes("Updated question text"))) {
    changes.push(
      <ChangeComparison
        key="title"
        label="Question Title"
        before={originalQuestion.question}
        after={currentQuestion.question}
        type="markdown"
      />,
    );
  }

  // Check for type changes
  if (changeDetails.some((d) => d.includes("Changed question type"))) {
    changes.push(
      <ChangeComparison
        key="type"
        label="Question Type"
        before={originalQuestion.type}
        after={currentQuestion.type}
      />,
    );
  }

  // Check for response type changes
  if (changeDetails.some((d) => d.includes("Changed response type"))) {
    changes.push(
      <ChangeComparison
        key="responseType"
        label="Response Type"
        before={originalQuestion.responseType}
        after={currentQuestion.responseType}
      />,
    );
  }

  // Check for max words/characters changes
  if (changeDetails.some((d) => d.includes("Updated max words"))) {
    changes.push(
      <ChangeComparison
        key="maxWords"
        label="Max Words"
        before={originalQuestion.maxWords}
        after={currentQuestion.maxWords}
        type="number"
      />,
    );
  }

  if (changeDetails.some((d) => d.includes("Updated max characters"))) {
    changes.push(
      <ChangeComparison
        key="maxChars"
        label="Max Characters"
        before={originalQuestion.maxCharacters}
        after={currentQuestion.maxCharacters}
        type="number"
      />,
    );
  }

  // Check for randomized choices changes
  if (changeDetails.some((d) => d.includes("Updated randomized choices"))) {
    changes.push(
      <ChangeComparison
        key="randomized"
        label="Randomized Choices"
        before={originalQuestion.randomizedChoices}
        after={currentQuestion.randomizedChoices}
        type="boolean"
      />,
    );
  }

  // Check for show rubrics to learner changes
  if (
    changeDetails.some((d) => d.includes('Changed "show rubric to learner"'))
  ) {
    changes.push(
      <ChangeComparison
        key="showRubrics"
        label="Show Rubrics to Learner"
        before={originalQuestion.scoring?.showRubricsToLearner}
        after={currentQuestion.scoring?.showRubricsToLearner}
        type="boolean"
      />,
    );
  }

  // Check for show points changes
  if (
    changeDetails.some((d) => d.includes('Changed "show points to learner"'))
  ) {
    changes.push(
      <ChangeComparison
        key="showPoints"
        label="Show Points to Learner"
        before={originalQuestion.scoring?.showPoints}
        after={currentQuestion.scoring?.showPoints}
        type="boolean"
      />,
    );
  }

  // Check for choices changes (for multiple choice questions)
  if (changeDetails.some((d) => d.includes("Modified choices"))) {
    changes.push(
      <div key="choices" className="mb-4">
        <h6 className="text-sm font-medium text-gray-600 mb-2">Choices</h6>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <MinusIcon className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium text-red-600">Before</span>
            </div>
            <div className="space-y-2">
              {originalQuestion.choices?.map((choice: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 bg-red-50 border border-red-200 rounded text-sm"
                >
                  <div className="flex items-start gap-2">
                    <span className="font-medium">Choice {idx + 1}:</span>
                    <span>{choice.choice || "(empty)"}</span>
                    {choice.isCorrect && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        Correct
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      Points: {choice.points}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PlusIcon className="w-4 h-4 text-green-500" />
              <span className="text-xs font-medium text-green-600">After</span>
            </div>
            <div className="space-y-2">
              {currentQuestion.choices?.map((choice: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 bg-green-50 border border-green-200 rounded text-sm"
                >
                  <div className="flex items-start gap-2">
                    <span className="font-medium">Choice {idx + 1}:</span>
                    <span>{choice.choice || "(empty)"}</span>
                    {choice.isCorrect && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        Correct
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      Points: {choice.points}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>,
    );
  }

  // Check for rubric changes
  if (changeDetails.some((d) => d.includes("Updated scoring criteria"))) {
    changes.push(
      <div key="rubrics" className="mb-4">
        <h6 className="text-sm font-medium text-gray-600 mb-2">
          Rubric Changes
        </h6>
        <div className="p-3 bg-purple-50 border border-purple-200 rounded text-sm text-purple-900">
          Rubric criteria have been modified
        </div>
      </div>,
    );
  }

  // Check for presentation/recording config changes
  if (
    changeDetails.some((d) => d.includes("Updated video presentation config"))
  ) {
    changes.push(
      <div key="videoConfig" className="mb-4">
        <h6 className="text-sm font-medium text-gray-600 mb-2">
          Video Presentation Configuration
        </h6>
        <div className="p-3 bg-purple-50 border border-purple-200 rounded text-sm text-purple-900">
          Video presentation settings have been modified
        </div>
      </div>,
    );
  }

  if (changeDetails.some((d) => d.includes("Updated live recording config"))) {
    changes.push(
      <div key="liveConfig" className="mb-4">
        <h6 className="text-sm font-medium text-gray-600 mb-2">
          Live Recording Configuration
        </h6>
        <div className="p-3 bg-purple-50 border border-purple-200 rounded text-sm text-purple-900">
          Live recording settings have been modified
        </div>
      </div>,
    );
  }

  // Check for variant changes
  const variantChanges = changeDetails.filter((d) => d.includes("variant"));
  if (variantChanges.length > 0) {
    changes.push(
      <div key="variants" className="mb-4">
        <h6 className="text-sm font-medium text-gray-600 mb-2">
          Variant Changes
        </h6>
        <div className="space-y-2">
          {variantChanges.map((change, idx) => (
            <div
              key={idx}
              className="p-2 bg-purple-50 border border-purple-200 rounded text-sm text-purple-900"
            >
              {change}
            </div>
          ))}
        </div>
      </div>,
    );
  }

  if (changes.length === 0) return null;

  return (
    <div className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-purple-200 shadow-sm hover:shadow-md transition-all mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg font-medium text-gray-900">
          Question {index + 1}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
          <PencilIcon className="w-3 h-3" />
          Modified
        </span>
      </div>
      <button
        onClick={onNavigateToQuestion}
        className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
      >
        Go to question
        <ArrowRightIcon className="w-3 h-3" />
      </button>
      {changes}
    </div>
  );
};

function Component() {
  const [viewMode, setViewMode] = useState<"changes" | "full">("changes");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isIssuesModalOpen, setIsIssuesModalOpen] = useState(false);

  const [
    graded,
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts,
    passingGrade,
    displayOrder,
    questionDisplay,
    numberOfQuestionsPerAttempt,
    strictTimeLimit,
  ] = useAssignmentConfig((state) => [
    state.graded,
    state.allotedTimeMinutes,
    state.timeEstimateMinutes,
    state.numAttempts,
    state.passingGrade,
    state.displayOrder,
    state.questionDisplay,
    state.numberOfQuestionsPerAttempt,
    state.strictTimeLimit,
  ]);

  const [
    introduction,
    instructions,
    gradingCriteriaOverview,
    questions,
    originalAssignment,
    learningObjectives,
    name,
    questionOrder,
    replaceQuestion,
    addQuestion,
  ] = useAuthorStore((state) => [
    state.introduction,
    state.instructions,
    state.gradingCriteriaOverview,
    state.questions,
    state.originalAssignment,
    state.learningObjectives,
    state.name,
    state.questionOrder,
    state.replaceQuestion,
    state.addQuestion,
  ]);

  const [
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
    showQuestions,
    showCorrectAnswer,
  ] = useAssignmentFeedbackConfig((state) => [
    state.verbosityLevel,
    state.showSubmissionFeedback,
    state.showQuestionScore,
    state.showAssignmentScore,
    state.showQuestions,
    state.showCorrectAnswer,
  ]);

  const router = useRouter();
  const pathname = usePathname();
  const activeAssignmentId = extractAssignmentId(pathname);
  const changesSummary = useChangesSummary();
  const questionsAreReadyToBePublished =
    useQuestionsAreReadyToBePublished(questions);
  const { isValid, message, invalidQuestionId } =
    questionsAreReadyToBePublished();

  // Parse changes from the summary
  const changes = useMemo(() => {
    const changesArray = changesSummary.split(". ").filter((c) => c);
    // remove "no changes detected" message
    const filteredChanges = changesArray.filter(
      (c) => c !== "No changes detected.",
    );
    return {
      introduction: filteredChanges.some((c) =>
        c.includes("Modified introduction"),
      ),
      instructions: filteredChanges.some((c) =>
        c.includes("Changed instructions"),
      ),
      gradingCriteria: filteredChanges.some((c) =>
        c.includes("Updated grading criteria overview"),
      ),
      showQuestions: filteredChanges.some((c) =>
        c.includes("Changed question visibility"),
      ),
      showSubmissionFeedback: filteredChanges.some((c) =>
        c.includes("Changed submission feedback visibility"),
      ),
      showQuestionScore: filteredChanges.some((c) =>
        c.includes("Changed question score visibility"),
      ),
      showAssignmentScore: filteredChanges.some((c) =>
        c.includes("Changed assignment score visibility"),
      ),
      showCorrectAnswer: filteredChanges.some((c) =>
        c.includes("Changed correct answer visibility"),
      ),
      questionOrder: filteredChanges.some((c) =>
        c.includes("Modified question order"),
      ),
      questionDisplay: filteredChanges.some((c) =>
        c.includes("Changed question display type"),
      ),
      numberOfQuestionsPerAttempt: filteredChanges.some((c) =>
        c.includes("Updated number of questions per attempt"),
      ),
      numAttempts: filteredChanges.some((c) =>
        c.includes("Updated number of attempts"),
      ),
      passingGrade: filteredChanges.some((c) =>
        c.includes("Modified passing grade"),
      ),
      timeEstimate: filteredChanges.some((c) =>
        c.includes("Updated time estimate"),
      ),
      allotedTime: filteredChanges.some((c) => c.includes("Set alloted time")),
      displayOrder: filteredChanges.some((c) =>
        c.includes("Modified question order"),
      ),
      graded: filteredChanges.some(
        (c) => c.includes("Enabled grading") || c.includes("Disabled grading"),
      ),
      questionsAdded: filteredChanges.find((c) =>
        c.includes("questions added"),
      ),
      questionsDeleted: filteredChanges.find((c) =>
        c.includes("questions deleted"),
      ),
      hasAnyChanges: changesSummary !== "No changes detected.",
      summary: changesSummary,
      details: filteredChanges,
    };
  }, [changesSummary]);
  const getQuestionIndices = (
    questionIds: number[],
    allQuestions: QuestionAuthorStore[],
  ) => {
    if (!questionIds || !allQuestions) return [];
    return questionIds
      .map((id) => {
        const index = allQuestions.findIndex((q) => q.id === id);
        return index >= 0 ? index + 1 : null;
      })
      .filter((idx) => idx !== null);
  };

  // Helper function to format question order for display
  const formatQuestionOrder = (
    order: number[],
    allQuestions: QuestionAuthorStore[],
  ) => {
    const indices = getQuestionIndices(order, allQuestions);
    return indices.length > 0
      ? `Questions: ${indices.join(", ")}`
      : "Default order";
  };
  // Identify problematic questions
  const questionIssues = useMemo(() => {
    const issues: Record<number, string[]> = {};

    questions?.forEach((q) => {
      const qIssues: string[] = [];

      if (q.type === "EMPTY") {
        qIssues.push("Question type not selected");
      }

      if (!q.question || q.question.trim() === "") {
        qIssues.push("Question title is empty");
      }

      if (
        (q.type === "MULTIPLE_CORRECT" || q.type === "SINGLE_CORRECT") &&
        (!q.choices || q.choices.length === 0)
      ) {
        qIssues.push("No choices added");
      }

      if (
        (q.type === "MULTIPLE_CORRECT" || q.type === "SINGLE_CORRECT") &&
        q.choices?.some((c) => !c.choice || c.choice.trim() === "")
      ) {
        qIssues.push("Some choices are empty");
      }

      if (q.type === "TEXT" || q.type === "URL" || q.type === "UPLOAD") {
        if (!q.scoring?.rubrics || q.scoring.rubrics.length === 0) {
          qIssues.push("No rubrics defined");
        } else {
          // Check each rubric
          q.scoring.rubrics.forEach((rubric, rubricIndex) => {
            // Check if rubric question is empty
            if (!rubric.rubricQuestion || rubric.rubricQuestion.trim() === "") {
              qIssues.push(`Rubric ${rubricIndex + 1} question is empty`);
            }

            if (!rubric.criteria || rubric.criteria.length === 0) {
              qIssues.push(`Rubric ${rubricIndex + 1} has no criteria defined`);
            } else {
              // Check each criteria in the rubric
              rubric.criteria.forEach((criteria, criteriaIndex) => {
                if (
                  !criteria.description ||
                  criteria.description.trim() === ""
                ) {
                  qIssues.push(
                    `Rubric ${rubricIndex + 1} criteria ${criteriaIndex + 1} description is empty`,
                  );
                }
              });
            }
          });
        }
      }

      if (qIssues.length > 0) {
        issues[q.id] = qIssues;
      }
    });

    return issues;
  }, [questions]);

  // Get question-specific changes
  const getQuestionChanges = (questionId: number) => {
    return changes.details.filter((d) => d.includes(`question ${questionId}`));
  };

  // Handle navigation to fix a specific question
  const handleNavigateToFix = (questionId: number) => {
    setIsIssuesModalOpen(false);
    router.push(`/author/${activeAssignmentId}/questions`);
    setTimeout(() => {
      const element = document.getElementById(`question-${questionId}`);
      if (element) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, 500);
  };

  // Handle navigation to config page
  const handleNavigateToConfig = () => {
    router.push(`/author/${activeAssignmentId}/config`);
  };

  // Handle auto-fix functionality
  const handleAutoFix = (questionId: number, issue: string) => {
    const question = questions?.find((q) => q.id === questionId);
    if (!question) return;

    let updatedQuestion = { ...question };

    // Auto-fix based on issue type
    if (issue.includes("Question type not selected")) {
      updatedQuestion.type = "TEXT"; // Default to text question
    }

    if (issue.includes("Question title is empty")) {
      updatedQuestion.question = "Untitled Question";
    }

    if (
      issue.includes("No choices added") &&
      (question.type === "MULTIPLE_CORRECT" ||
        question.type === "SINGLE_CORRECT")
    ) {
      updatedQuestion.choices = [
        { choice: "Option 1", isCorrect: true, points: 1 },
        { choice: "Option 2", isCorrect: false, points: 0 },
      ];
    }

    // Handle rubric-related issues
    if (issue.includes("No rubrics defined")) {
      updatedQuestion.scoring = {
        ...updatedQuestion.scoring,
        rubrics: [
          {
            rubricQuestion: "Default Rubric",
            criteria: [
              {
                description: "Default criteria description",
                points: 1,
                id: 1,
              },
            ],
          },
        ],
      };
    }

    if (issue.includes("has no criteria defined")) {
      // Extract rubric index from issue text like "Rubric 1 has no criteria defined"
      const rubricMatch = issue.match(/Rubric (\d+)/);
      if (rubricMatch && updatedQuestion.scoring?.rubrics) {
        const rubricIndex = parseInt(rubricMatch[1]) - 1;
        if (updatedQuestion.scoring.rubrics[rubricIndex]) {
          updatedQuestion.scoring.rubrics[rubricIndex].criteria = [
            {
              description: "Default criteria description",
              points: 1,
              id: 1,
            },
          ];
        }
      }
    }

    if (issue.includes("description is empty")) {
      // Extract rubric and criteria indices from issue text like "Rubric 1 criteria 1 description is empty"
      const match = issue.match(/Rubric (\d+) criteria (\d+)/);
      if (match && updatedQuestion.scoring?.rubrics) {
        const rubricIndex = parseInt(match[1]) - 1;
        const criteriaIndex = parseInt(match[2]) - 1;
        if (
          updatedQuestion.scoring.rubrics[rubricIndex]?.criteria?.[
            criteriaIndex
          ]
        ) {
          updatedQuestion.scoring.rubrics[rubricIndex].criteria[
            criteriaIndex
          ].description = "Default criteria description";
        }
      }
    }

    if (issue.includes("question is empty")) {
      // Extract rubric index from issue text like "Rubric 1 question is empty"
      const rubricMatch = issue.match(/Rubric (\d+)/);
      if (rubricMatch && updatedQuestion.scoring?.rubrics) {
        const rubricIndex = parseInt(rubricMatch[1]) - 1;
        if (updatedQuestion.scoring.rubrics[rubricIndex]) {
          updatedQuestion.scoring.rubrics[rubricIndex].rubricQuestion =
            "Default Rubric Question";
        }
      }
    }

    // Update the question in the store
    replaceQuestion(questionId, updatedQuestion);

    // Show a success message (you could replace this with a toast notification)
    alert(`Auto-fixed: ${issue}`);
  };

  // Handle export functionality
  const handleExport = async (exportOptions: ExportOptions) => {
    try {
      // Prepare the export data based on selected options
      const exportData: any = {};

      if (exportOptions.includeAssignmentData) {
        exportData.assignment = {
          name,
          introduction,
          instructions,
          learningObjectives,
        };
      }

      if (exportOptions.includeConfig) {
        exportData.config = {
          graded,
          allotedTimeMinutes,
          timeEstimateMinutes,
          numAttempts,
          passingGrade,
          displayOrder,
          questionDisplay,
          numberOfQuestionsPerAttempt,
          strictTimeLimit,
        };
      }

      if (exportOptions.includeFeedbackConfig) {
        exportData.feedbackConfig = {
          verbosityLevel,
          showSubmissionFeedback,
          showQuestionScore,
          showAssignmentScore,
          showQuestions,
        };
      }

      if (exportOptions.includeGradingCriteria) {
        exportData.gradingCriteria = gradingCriteriaOverview;
      }

      if (exportOptions.includeQuestions) {
        exportData.questions = questions?.map((q) => {
          const questionData: any = {
            type: q.type,
            question: q.question,
            responseType: q.responseType,
            maxWords: q.maxWords,
            maxCharacters: q.maxCharacters,
            totalPoints: q.totalPoints,
            numRetries: q.numRetries,
            randomizedChoices: q.randomizedChoices,
          };

          if (exportOptions.includeQuestionChoices && q.choices) {
            questionData.choices = q.choices;
          }

          if (exportOptions.includeRubrics && q.scoring) {
            questionData.scoring = q.scoring;
          }

          if (exportOptions.includeVariants && q.variants) {
            questionData.variants = q.variants;
          }

          return questionData;
        });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `assignment-${activeAssignmentId}-${timestamp}`;

      // Handle different export formats
      if (exportOptions.format === "json") {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: "application/json",
        });
        downloadFile(blob, `${filename}.json`);
      } else if (exportOptions.format === "csv") {
        // Convert to CSV format (simplified)
        const csvContent = convertToCSV(exportData);
        const blob = new Blob([csvContent], { type: "text/csv" });
        downloadFile(blob, `${filename}.csv`);
      } else if (exportOptions.format === "pdf") {
        // Generate actual PDF
        await generatePDF(exportData, filename);
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Export failed. Please try again.");
    }
  };

  // Helper function to download file
  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Helper function to convert data to CSV
  const convertToCSV = (data: any) => {
    let csv = "";

    if (data.assignment) {
      csv += "Assignment Information\n";
      csv += `Name,${data.assignment.name}\n\n`;
    }

    if (data.questions) {
      csv += "Questions\n";
      csv += "Type,Question,Response Type,Total Points\n";
      data.questions.forEach((q: any) => {
        csv += `${q.type},"${q.question?.replace(/"/g, '""') || ""}",${q.responseType},${q.totalPoints}\n`;
      });
    }

    return csv;
  };

  // Helper function to format data for PDF/text export
  const formatForPDF = (data: any) => {
    let content = "ASSIGNMENT EXPORT\n";
    content += "=".repeat(50) + "\n\n";

    if (data.assignment) {
      content += "ASSIGNMENT INFORMATION\n";
      content += "-".repeat(25) + "\n";
      content += `Name: ${data.assignment.name}\n`;
      if (data.assignment.introduction) {
        content += `\nIntroduction:\n${data.assignment.introduction}\n`;
      }
      if (data.assignment.instructions) {
        content += `\nInstructions:\n${data.assignment.instructions}\n`;
      }
      content += "\n";
    }

    if (data.questions) {
      content += "QUESTIONS\n";
      content += "-".repeat(15) + "\n";
      data.questions.forEach((q: any, index: number) => {
        content += `\nQuestion ${index + 1}:\n`;
        content += `Type: ${q.type}\n`;
        content += `Content: ${q.question || "No content"}\n`;
        if (q.choices) {
          content += "Choices:\n";
          q.choices.forEach((choice: any, i: number) => {
            content += `  ${i + 1}. ${choice.choice} ${choice.isCorrect ? "(Correct)" : ""}\n`;
          });
        }
        content += "\n";
      });
    }

    return content;
  };

  // Helper function to generate PDF using browser's print functionality
  const generatePDF = async (data: any, filename: string) => {
    try {
      // Create a formatted HTML content for PDF
      const htmlContent = formatForPDF(data);

      // Create a new window with the content
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        throw new Error(
          "Unable to open print window. Please allow popups and try again.",
        );
      }

      // Write the HTML content with proper styling
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Assignment Export - ${filename}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              margin: 20px;
              color: #333;
              padding-right: 100px;
              padding-left: 100px;
              padding-top: 100px;
            }
            h1 {
              color: #2563eb;
              border-bottom: 2px solid #2563eb;
              padding-bottom: 10px;
            }
            h2 {
              color: #1f2937;
              margin-top: 30px;
              margin-bottom: 15px;
            }
            h3 {
              color: #374151;
              margin-top: 20px;
              margin-bottom: 10px;
            }
            .question {
              margin-bottom: 25px;
              padding: 15px;
              border-left: 3px solid #3b82f6;
              background-color: #f8fafc;
            }
            .choice {
              margin-left: 20px;
              margin-bottom: 5px;
            }
            .correct {
              font-weight: bold;
              color: #059669;
            }
            .rubric {
              margin-left: 20px;
              margin-bottom: 10px;
            }
            .criterion {
              margin-left: 40px;
              margin-bottom: 5px;
              font-size: 0.9em;
            }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>Assignment Export</h1>
          ${formatDataAsHTML(data)}
          <div class="no-print" style="margin-top: 30px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">
              Print / Save as PDF
            </button>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
              Close
            </button>
          </div>
        </body>
        </html>
      `);

      printWindow.document.close();

      // Focus on the new window
      printWindow.focus();
    } catch (error) {
      console.error("PDF generation failed:", error);
      // Fallback to text export
      const pdfContent = formatForPDF(data);
      const blob = new Blob([pdfContent], { type: "text/plain" });
      downloadFile(blob, `${filename}.txt`);
      alert("PDF generation failed. Exported as text file instead.");
    }
  };

  // Helper function to format data as HTML
  const formatDataAsHTML = (data: any) => {
    let html = "";

    if (data.assignment) {
      html += "<h2>Assignment Information</h2>";
      html += `<p><strong>Name:</strong> ${data.assignment.name}</p>`;

      if (data.assignment.introduction) {
        html += "<h3>Introduction:</h3>";
        html += `<div>${data.assignment.introduction}</div>`;
      }

      if (data.assignment.instructions) {
        html += "<h3>Instructions:</h3>";
        html += `<div>${data.assignment.instructions}</div>`;
      }
    }

    if (data.questions && data.questions.length > 0) {
      html += "<h2>Questions</h2>";

      data.questions.forEach((q: any, index: number) => {
        html += `<div class="question">`;
        html += `<h3>Question ${index + 1}</h3>`;
        html += `<p><strong>Type:</strong> ${q.type}</p>`;
        html += `<p><strong>Content:</strong> ${q.question || "No content"}</p>`;
        html += `<p><strong>Total Points:</strong> ${q.totalPoints}</p>`;

        if (q.choices && q.choices.length > 0) {
          html += "<h4>Choices:</h4>";
          q.choices.forEach((choice: any, i: number) => {
            const correctClass = choice.isCorrect ? "correct" : "";
            const correctText = choice.isCorrect ? " (Correct)" : "";
            html += `<div class="choice ${correctClass}">${i + 1}. ${choice.choice}${correctText} - ${choice.points} points</div>`;
          });
        }

        if (q.scoring?.rubrics && q.scoring.rubrics.length > 0) {
          html += "<h4>Rubrics:</h4>";
          q.scoring.rubrics.forEach((rubric: any) => {
            html += `<div class="rubric"><strong>${rubric.rubricQuestion}</strong></div>`;
            if (rubric.criteria && rubric.criteria.length > 0) {
              rubric.criteria.forEach((criterion: any) => {
                html += `<div class="criterion">${criterion.points} pts: ${criterion.description}</div>`;
              });
            }
          });
        }

        html += "</div>";
      });
    }

    if (data.config) {
      html += "<h2>Assignment Configuration</h2>";
      html += `<p><strong>Graded:</strong> ${data.config.graded ? "Yes" : "No"}</p>`;
      html += `<p><strong>Time Limit:</strong> ${data.config.allotedTimeMinutes ? `${data.config.allotedTimeMinutes} minutes` : "No limit"}</p>`;
      html += `<p><strong>Attempts:</strong> ${data.config.numAttempts === -1 ? "Unlimited" : data.config.numAttempts}</p>`;
      html += `<p><strong>Passing Grade:</strong> ${data.config.passingGrade}%</p>`;
    }

    return html;
  };

  return (
    <main className="main-author-container">
      <div className="flex items-center justify-between mb-6">
        <Title>Review</Title>
        <div className="flex items-center gap-4">
          {/* Status Summary */}
          <div className="flex items-center gap-3">
            {changes.details.length ? (
              <span className="flex items-center gap-2 text-sm">
                <InformationCircleIcon className="w-5 h-5 text-purple-500" />
                <span className="font-medium">
                  {changes.details.length} changes detected
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <CheckCircleIcon className="w-5 h-5" />
                No changes detected
              </span>
            )}

            {!isValid && (
              <button
                onClick={() => setIsIssuesModalOpen(true)}
                className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-4 py-2 rounded-md transition-colors bg-red-100 border border-red-200"
              >
                <ExclamationTriangleIcon className="w-5 h-5" />
                {(() => {
                  const questionIssueCount = Object.keys(questionIssues).length;
                  const hasValidationError = !isValid && message;
                  const hasConfigError =
                    hasValidationError &&
                    !isQuestionRelatedValidationError(message);
                  const totalIssues =
                    questionIssueCount + (hasConfigError ? 1 : 0);

                  if (totalIssues === 0) {
                    return "Issues found"; // Fallback, shouldn't happen
                  }

                  if (questionIssueCount > 0 && hasConfigError) {
                    return `${totalIssues} issues found`;
                  } else if (questionIssueCount > 0) {
                    return `${questionIssueCount} question issue${questionIssueCount !== 1 ? "s" : ""} found`;
                  } else if (hasConfigError) {
                    return "Configuration issue found";
                  }

                  return "Issues found";
                })()}
              </button>
            )}
          </div>

          {/* Export Button */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 transition-colors flex items-center gap-2"
          >
            <DocumentArrowUpIcon className="w-4 h-4" />
            Export
          </button>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode("changes")}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                viewMode === "changes"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <div className="flex items-center gap-2">
                <EyeSlashIcon className="w-4 h-4" />
                Changes Only
              </div>
            </button>
            <button
              onClick={() => setViewMode("full")}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                viewMode === "full"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <div className="flex items-center gap-2">
                <EyeIcon className="w-4 h-4" />
                Full Review
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Changes Summary */}
      {changes.details.length ? (
        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <h3 className="font-semibold text-purple-900 mb-2">
            Changes Summary
          </h3>
          <ul className="space-y-1">
            {changes.details.map((change, idx) => (
              <li
                key={idx}
                className="text-sm text-purple-800 flex items-start gap-2"
              >
                <span className="text-purple-400 mt-1">•</span>
                {change}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-semibold text-green-900 mb-2">
            No Changes Detected
          </h3>
          <p className="text-sm text-green-800">
            Your assignment is up to date with no modifications needed.
          </p>
        </div>
      )}

      {viewMode === "full" ? (
        <>
          {/* Full View Mode */}
          <Section
            title="About this Assignment"
            content={introduction}
            link={`/author/${activeAssignmentId}`}
            hasChanges={changes.introduction}
            isValid={
              !!introduction &&
              introduction.trim() !== "" &&
              introduction.trim() !== "<p><br></p>"
            }
            errorMessage={
              !introduction ||
              introduction.trim() === "" ||
              introduction.trim() === "<p><br></p>"
                ? "Introduction is required"
                : ""
            }
          />

          <Section
            title="Learner Instructions"
            content={instructions}
            link={`/author/${activeAssignmentId}`}
            hasChanges={changes.instructions}
          />

          <Section
            title="Grading Criteria"
            content={gradingCriteriaOverview}
            link={`/author/${activeAssignmentId}`}
            hasChanges={changes.gradingCriteria}
          />
        </>
      ) : (
        <>
          {/* Changes View Mode */}
          {changes.introduction && originalAssignment && (
            <ChangesSection
              title="About this Assignment"
              link={`/author/${activeAssignmentId}`}
              changes={
                <ChangeComparison
                  label="Introduction Content"
                  before={originalAssignment.introduction}
                  after={introduction}
                  type="markdown"
                />
              }
            />
          )}

          {changes.instructions && originalAssignment && (
            <ChangesSection
              title="Learner Instructions"
              link={`/author/${activeAssignmentId}`}
              changes={
                <ChangeComparison
                  label="Instructions Content"
                  before={originalAssignment.instructions}
                  after={instructions}
                  type="markdown"
                />
              }
            />
          )}

          {changes.gradingCriteria && originalAssignment && (
            <ChangesSection
              title="Grading Criteria"
              link={`/author/${activeAssignmentId}`}
              changes={
                <ChangeComparison
                  label="Grading Criteria Overview"
                  before={originalAssignment.gradingCriteriaOverview}
                  after={gradingCriteriaOverview}
                  type="markdown"
                />
              }
            />
          )}

          {/* Configuration Changes */}
          {(changes.graded ||
            changes.allotedTime ||
            changes.timeEstimate ||
            changes.numAttempts ||
            changes.passingGrade ||
            changes.displayOrder ||
            changes.questionDisplay ||
            changes.showQuestions ||
            changes.showSubmissionFeedback ||
            changes.showQuestionScore ||
            changes.showAssignmentScore ||
            changes.numberOfQuestionsPerAttempt ||
            changes.questionOrder) &&
            originalAssignment && (
              <div className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-purple-200 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between w-full mb-4">
                  <div className="flex items-center gap-2">
                    <h4 className="text-grey-900 text-xl">
                      Assignment Configuration
                    </h4>
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
                      <PencilIcon className="w-3 h-3" />
                      Modified
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      router.push(`/author/${activeAssignmentId}/config`)
                    }
                    className="hover:bg-gray-100 p-2 rounded-md"
                  >
                    <PencilSquareIcon className="h-6 w-6 text-gray-500" />
                  </button>
                </div>

                <div className="space-y-4">
                  {changes.graded && (
                    <ChangeComparison
                      label="Assignment Type"
                      before={originalAssignment.graded ? "Graded" : "Practice"}
                      after={graded ? "Graded" : "Practice"}
                      onNavigate={() =>
                        router.push(`/author/${activeAssignmentId}/config`)
                      }
                    />
                  )}

                  {changes.allotedTime && (
                    <ChangeComparison
                      label="Alloted Time"
                      before={
                        originalAssignment.allotedTimeMinutes
                          ? `${originalAssignment.allotedTimeMinutes} minutes`
                          : "No time limit"
                      }
                      after={
                        allotedTimeMinutes
                          ? `${allotedTimeMinutes} minutes`
                          : "No time limit"
                      }
                    />
                  )}

                  {changes.timeEstimate && (
                    <ChangeComparison
                      label="Time Estimate"
                      before={
                        originalAssignment.timeEstimateMinutes
                          ? `${originalAssignment.timeEstimateMinutes} minutes`
                          : "Not set"
                      }
                      after={
                        timeEstimateMinutes
                          ? `${timeEstimateMinutes} minutes`
                          : "Not set"
                      }
                    />
                  )}

                  {changes.numAttempts && (
                    <ChangeComparison
                      label="Number of Attempts"
                      before={
                        originalAssignment.numAttempts === -1
                          ? "Unlimited"
                          : originalAssignment.numAttempts
                      }
                      after={numAttempts === -1 ? "Unlimited" : numAttempts}
                    />
                  )}

                  {changes.passingGrade && (
                    <ChangeComparison
                      label="Passing Grade"
                      before={`${originalAssignment.passingGrade}%`}
                      after={`${passingGrade}%`}
                    />
                  )}

                  {changes.displayOrder && (
                    <ChangeComparison
                      label="Display Order"
                      before={originalAssignment.displayOrder}
                      after={displayOrder}
                    />
                  )}

                  {changes.questionDisplay && (
                    <ChangeComparison
                      label="Question Display"
                      before={originalAssignment.questionDisplay?.replace(
                        /_/g,
                        " ",
                      )}
                      after={questionDisplay?.replace(/_/g, " ")}
                    />
                  )}

                  {changes.numberOfQuestionsPerAttempt && (
                    <ChangeComparison
                      label="Questions Per Attempt"
                      before={originalAssignment.numberOfQuestionsPerAttempt}
                      after={numberOfQuestionsPerAttempt}
                      type="number"
                    />
                  )}

                  {changes.showQuestions && (
                    <ChangeComparison
                      label="Show Questions"
                      before={originalAssignment.showQuestions}
                      after={showQuestions}
                      type="boolean"
                    />
                  )}

                  {changes.showSubmissionFeedback && (
                    <ChangeComparison
                      label="Show Submission Feedback"
                      before={originalAssignment.showSubmissionFeedback}
                      after={showSubmissionFeedback}
                      type="boolean"
                    />
                  )}

                  {changes.showQuestionScore && (
                    <ChangeComparison
                      label="Show Question Score"
                      before={originalAssignment.showQuestionScore}
                      after={showQuestionScore}
                      type="boolean"
                    />
                  )}

                  {changes.showAssignmentScore && (
                    <ChangeComparison
                      label="Show Assignment Score"
                      before={originalAssignment.showAssignmentScore}
                      after={showAssignmentScore}
                      type="boolean"
                    />
                  )}

                  {changes.questionOrder && (
                    <ChangeComparison
                      label="Question Order"
                      before={formatQuestionOrder(
                        originalAssignment.questionOrder,
                        originalAssignment.questions,
                      )}
                      after={formatQuestionOrder(questionOrder, questions)}
                      onNavigate={() =>
                        router.push(`/author/${activeAssignmentId}/questions`)
                      }
                    />
                  )}
                </div>
              </div>
            )}
        </>
      )}

      {/* Questions Section */}
      <div className="mt-8 text-center">
        <div className="flex items-center justify-between  text-center mb-4">
          {changes.questionsAdded ||
          changes.questionsDeleted ||
          Object.keys(questionIssues).length > 0 ? (
            <>
              <Title>Questions</Title>
              <div className="flex items-center gap-4">
                {changes.questionsAdded && (
                  <span className="text-sm text-green-600">
                    {changes.questionsAdded}
                  </span>
                )}
                {changes.questionsDeleted && (
                  <span className="text-sm text-red-600">
                    {changes.questionsDeleted}
                  </span>
                )}
                {Object.keys(questionIssues).length > 0 && (
                  <span className="text-sm text-red-600 flex items-center gap-2">
                    <ExclamationTriangleIcon className="w-4 h-4" />
                    {Object.keys(questionIssues).length} question(s) have issues
                  </span>
                )}
              </div>
            </>
          ) : (
            <></>
          )}
        </div>

        {viewMode === "full" ? (
          // Full view - show all questions
          questions && questions.length > 0 ? (
            questions.map((question, index) => {
              const hasIssues = questionIssues[question.id];
              const questionChanges = getQuestionChanges(question.id);

              return (
                <div
                  key={question.id}
                  className={cn(
                    "flex flex-col gap-y-4 px-8 py-6 bg-white rounded border shadow-sm hover:shadow-md transition-all mb-4",
                    hasIssues && "border-red-300 bg-red-50/30",
                    questionChanges.length > 0 &&
                      !hasIssues &&
                      "border-purple-300 bg-purple-50/30",
                    !hasIssues &&
                      questionChanges.length === 0 &&
                      "border-gray-200",
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-600">
                        Question {index + 1}
                      </span>
                      {questionChanges.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
                          <PencilIcon className="w-3 h-3" />
                          Modified
                        </span>
                      )}
                      {hasIssues && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-full">
                          <ExclamationTriangleIcon className="w-3 h-3" />
                          {hasIssues.length} issue
                          {hasIssues.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {hasIssues && (
                    <div className="mb-4 space-y-1">
                      {hasIssues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="text-sm text-red-600 flex items-start gap-2"
                        >
                          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          {issue}
                        </div>
                      ))}
                    </div>
                  )}

                  <Question
                    question={question}
                    questionId={question.id}
                    questionIndex={index + 1}
                    preview={true}
                  />
                </div>
              );
            })
          ) : (
            <p className="text-gray-500">No questions added yet.</p>
          )
        ) : (
          // Changes view - show only changed questions with before/after
          <>
            {/* Show new questions */}
            {questions?.map((question, index) => {
              const originalQuestion = originalAssignment?.questions?.find(
                (q) => q.id === question.id,
              );
              const isNewQuestion = !originalQuestion;

              if (!isNewQuestion) return null;

              return (
                <div
                  key={question.id}
                  className="flex flex-col gap-y-4 px-8 py-6 bg-white  rounded border border-green-200 shadow-sm hover:shadow-md transition-all mb-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg font-medium text-gray-900">
                      Question {index + 1}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                      <StarIcon className="w-3 h-3" />
                      New Question
                    </span>
                  </div>
                  <Question
                    question={question}
                    questionId={question.id}
                    questionIndex={index + 1}
                    preview={true}
                  />
                </div>
              );
            })}

            {/* Show modified questions */}
            {originalAssignment?.questions &&
              questions?.map((question, index) => {
                const originalQuestion = originalAssignment.questions.find(
                  (q) => q.id === question.id,
                );
                if (!originalQuestion) return null;

                const questionChanges = getQuestionChanges(question.id);
                if (questionChanges.length === 0) return null;

                return (
                  <QuestionChanges
                    key={question.id}
                    originalQuestion={originalQuestion}
                    currentQuestion={question}
                    index={index}
                    changeDetails={questionChanges}
                    onNavigateToQuestion={() => {
                      router.push(`/author/${activeAssignmentId}/questions`);
                      setTimeout(() => {
                        const element = document.getElementById(
                          `question-${question.id}`,
                        );
                        if (element) {
                          element.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }
                      }, 500);
                    }}
                  />
                );
              })}

            {/* Show deleted questions */}
            {originalAssignment?.questions?.map((origQuestion, index) => {
              const stillExists = questions?.some(
                (q) => q.id === origQuestion.id,
              );
              if (stillExists) return null;

              return (
                <div
                  key={origQuestion.id}
                  className="flex flex-col gap-y-4 px-8 py-6 bg-red-50 rounded border border-red-200 shadow-sm hover:shadow-md transition-all mb-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg font-medium text-gray-900">
                      Question (Deleted)
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-full">
                      <MinusIcon className="w-3 h-3" />
                      Deleted
                    </span>
                  </div>
                  <div className="text-sm text-red-700">
                    <p className="font-medium">Type: {origQuestion.type}</p>
                    <p>Title: {origQuestion.question || "No title"}</p>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onExport={handleExport}
      />

      {/* Issues Modal */}
      <IssuesModal
        isOpen={isIssuesModalOpen}
        onClose={() => setIsIssuesModalOpen(false)}
        questionIssues={questionIssues}
        questions={questions || []}
        isValid={isValid}
        message={message}
        invalidQuestionId={invalidQuestionId}
        onNavigateToFix={handleNavigateToFix}
        onAutoFix={handleAutoFix}
        onNavigateToConfig={handleNavigateToConfig}
      />
    </main>
  );
}

export default Component;
