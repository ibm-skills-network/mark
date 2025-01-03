import MarkdownViewer from "@/components/MarkdownViewer";
import { QuestionDisplayType, QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import { useLearnerStore } from "@/stores/learner";
import {
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
} from "@heroicons/react/24/outline";
import { IconBookmark, IconBookmarkFilled } from "@tabler/icons-react";
import { ComponentPropsWithoutRef, useEffect, useMemo, useState } from "react";
import RenderQuestion from "./RenderQuestion";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
  questionNumber: number;
  questionId: number;
  questionDisplay: QuestionDisplayType;
  lastQuestionNumber: number;
}

function Component(props: Props) {
  const {
    className,
    questionId,
    questionNumber,
    question,
    questionDisplay,
    lastQuestionNumber,
  } = props;

  const [activeQuestionNumber, setActiveQuestionNumber] = useLearnerStore(
    (state) => [state.activeQuestionNumber, state.setActiveQuestionNumber],
  );
  const setQuestionStatus = useLearnerStore((state) => state.setQuestionStatus);
  const getQuestionStatusById = useLearnerStore(
    (state) => state.getQuestionStatusById,
  );
  // Get the questionStatus directly from the store
  const questionStatus = getQuestionStatusById
    ? getQuestionStatusById(questionId)
    : "unedited"; // Fallback status

  let questionTypeText: string;
  if (question.type === "MULTIPLE_CORRECT") {
    questionTypeText = "MULTIPLE SELECT";
  } else if (question.type === "SINGLE_CORRECT") {
    questionTypeText = "MULTIPLE CHOICE";
  } else if (question.type === "TRUE_FALSE") {
    questionTypeText = "TRUE OR FALSE";
  } else {
    questionTypeText = question.type;
  }

  // Handle flagging/unflagging
  const handleFlaggingQuestion = () => {
    if (questionStatus === "flagged") {
      setQuestionStatus(questionId, "unflagged");
    } else {
      setQuestionStatus(questionId, "flagged");
    }
  };

  return (
    <section
      id={`item-${questionNumber}`}
      onClick={() => {
        if (questionDisplay === "ALL_PER_PAGE") {
          setActiveQuestionNumber(questionNumber);
        }
      }}
      className={cn(
        "flex bg-white rounded flex-col gap-y-4 p-6 relative shadow hover:shadow-md border ",
        className,
        `${activeQuestionNumber === questionNumber ? "border-violet-600" : ""}`,
      )}
    >
      {/* Question Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-x-2">
          <p className="text-gray-700 text-xl font-semibold">
            Question {questionNumber}
          </p>
          <span className="text-md text-gray-600">|</span>
          <span className="text-md text-gray-600">{questionTypeText}</span>
        </div>
        <div className="flex items-center gap-x-2">
          {/* Flag Question Button */}
          <button
            className="text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
            onClick={handleFlaggingQuestion}
          >
            <Bookmark questionStatus={questionStatus} />
          </button>
          <span className="text-md text-violet-600 bg-violet-100 rounded-md px-2 py-1">
            {question.totalPoints} points
          </span>
        </div>
      </div>

      {/* Question Card */}
      <MarkdownViewer className="text-gray-800 border-b border-gray-300 pb-4">
        {question.question}
      </MarkdownViewer>
      <RenderQuestion questionType={question.type} question={question} />

      {questionDisplay === "ONE_PER_PAGE" && (
        <div className="flex justify-between">
          <button
            onClick={() => setActiveQuestionNumber(questionNumber - 1)}
            disabled={questionNumber === 1}
            className="disabled:opacity-50 disabled:pointer-events-none text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
          >
            <ArrowLongLeftIcon
              strokeWidth={2}
              className="w-5 h-5 transition-transform group-hover:-translate-x-1"
            />
            Previous Question
          </button>
          <button
            onClick={() => setActiveQuestionNumber(questionNumber + 1)}
            disabled={questionNumber === lastQuestionNumber}
            className="disabled:opacity-50 disabled:pointer-events-none text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
          >
            Next Question
            <ArrowLongRightIcon
              strokeWidth={2}
              className="w-5 h-5 transition-transform group-hover:translate-x-1"
            />
          </button>
        </div>
      )}
    </section>
  );
}

export default Component;

function Bookmark({ questionStatus }) {
  return questionStatus === "flagged" ? (
    <IconBookmarkFilled className="w-5 h-5 text-violet-600" />
  ) : (
    <IconBookmark className="w-5 h-5 text-violet-600" />
  );
}
