"use client";

import MarkdownViewer from "@/components/MarkdownViewer";
import type { QuestionStore } from "@/config/types";
import { getFeedbackColors, parseLearnerResponse } from "@/lib/utils";
import { useLearnerStore } from "@/stores/learner";
import { motion } from "framer-motion";
import { FC, useMemo, useState } from "react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { SparklesIcon } from "@heroicons/react/24/solid";

interface Props {
  question: QuestionStore;
  number: number;
}

interface HighestScoreResponseType {
  points: number;
  feedback: { feedback: string }[];
}

export type LearnerResponseType =
  | string
  | string[]
  | boolean
  | { filename: string; content: string }[]
  | undefined;

const Question: FC<Props> = ({ question, number }) => {
  const {
    question: questionText,
    totalPoints,
    questionResponses,
    type,
    learnerChoices,
    learnerTextResponse,
    learnerUrlResponse,
    learnerAnswerChoice,
    learnerFileResponse,
    choices,
  } = question;
  const showSubmissionFeedback = useLearnerStore(
    (state) => state.showSubmissionFeedback,
  );
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(
    null,
  );
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const highestScoreResponse = useMemo<
    HighestScoreResponseType | undefined
  >(() => {
    if (!questionResponses || questionResponses.length === 0) {
      return showSubmissionFeedback
        ? { points: 0, feedback: [{ feedback: "This answer was blank" }] }
        : undefined;
    }
    return questionResponses.reduce((acc, curr) =>
      acc.points > curr.points ? acc : curr,
    );
  }, [questionResponses, showSubmissionFeedback]);

  const questionResponse = questionResponses?.[0];

  // Determine the learner's response
  const learnerResponse: LearnerResponseType =
    learnerTextResponse ??
    learnerFileResponse ??
    learnerUrlResponse ??
    learnerAnswerChoice ??
    (learnerChoices && learnerChoices.length > 0
      ? learnerChoices
      : undefined) ??
    (questionResponse?.learnerResponse
      ? parseLearnerResponse(questionResponse.learnerResponse)
      : undefined);

  // Function to display the learner's answer based on the question type
  const renderLearnerAnswer = () => {
    if (
      type === "TEXT" &&
      learnerResponse &&
      (typeof learnerResponse === "string" ||
        typeof learnerResponse === "boolean")
    ) {
      return (
        <MarkdownViewer className="text-gray-800">
          {learnerResponse.toString()}
        </MarkdownViewer>
      );
    } else if (
      (type === "URL" || type === "LINK_FILE") &&
      typeof learnerResponse === "string"
    ) {
      return (
        <a
          href={learnerResponse}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all"
        >
          {learnerResponse}
        </a>
      );
    } else if (
      (type === "SINGLE_CORRECT" || type === "MULTIPLE_CORRECT") &&
      Array.isArray(choices)
    ) {
      if (
        !learnerResponse ||
        (Array.isArray(learnerResponse) && learnerResponse.length === 0)
      ) {
        return (
          <p className="text-gray-800">
            No answer was provided by the learner.
          </p>
        );
      }

      const isSingleChoice = type === "SINGLE_CORRECT";

      return (
        <ul className="list-none text-gray-800 w-full flex flex-col justify-start gap-y-2">
          {choices.map((choiceObj, idx) => {
            const isSelected = Array.isArray(learnerResponse)
              ? (learnerResponse as string[]).includes(choiceObj.choice)
              : false;

            const isCorrect = choiceObj.isCorrect;

            return (
              <li
                key={idx}
                className={`flex items-center justify-between mb-2 px-2 py-2 ${
                  isSelected
                    ? isCorrect
                      ? "bg-green-50 border border-green-500 rounded"
                      : "bg-red-50 border border-red-700 rounded"
                    : isCorrect
                      ? "bg-green-50 border border-green-500 rounded"
                      : ""
                }`}
              >
                <div className="flex items-center">
                  {isSingleChoice ? (
                    <input
                      type="radio"
                      checked={isSelected}
                      readOnly
                      className="form-radio text-violet-600 mr-2"
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="form-checkbox text-violet-600 mr-2"
                    />
                  )}
                  <span className="font-medium">{choiceObj.choice}</span>
                </div>
                <div className="flex items-center">
                  {isCorrect && (
                    <CheckIcon className="w-5 h-5 text-green-500 ml-2" />
                  )}
                  {!isCorrect && isSelected && (
                    <XMarkIcon className="w-5 h-5 text-red-500 ml-2" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      );
    } else if (type === "TRUE_FALSE") {
      return (
        <p className={`text-gray-800 font-bold`}>
          {learnerResponse ? "True" : "False"}
        </p>
      );
    } else if (
      type === "CODE" ||
      type === "IMAGES" ||
      type === "UPLOAD" ||
      type === "LINK_FILE"
    ) {
      if (Array.isArray(learnerResponse) && learnerResponse.length > 0) {
        return (
          <ul className="list-disc ml-5 text-gray-800">
            {(
              learnerResponse as unknown as {
                filename: string;
                content: string;
              }[]
            ).map((file, idx) => (
              <li key={idx}>
                {file.filename}
                <button
                  onClick={() => {
                    setSelectedFileContent(file.content);
                    setSelectedFileName(file.filename);
                  }}
                  className="ml-2 text-blue-600 underline"
                >
                  View Content
                </button>
              </li>
            ))}
          </ul>
        );
      } else if (typeof learnerResponse === "string") {
        return <p className="text-gray-800">{learnerResponse}</p>;
      } else {
        return (
          <p className="text-gray-800">
            No answer was provided by the learner.
          </p>
        );
      }
    } else {
      return (
        <p className="text-gray-800">No answer was provided by the learner.</p>
      );
    }
  };

  return (
    <>
      <motion.div
        className="p-6 mb-6 bg-white rounded-lg shadow-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            Question {number}
          </h2>
          {highestScoreResponse?.points === -1 ? (
            <p className="text-sm text-gray-600">Points hidden</p>
          ) : (
            <p className="text-sm text-gray-600">
              Score:{" "}
              <span className="font-bold text-gray-800">
                {highestScoreResponse?.points || 0}/{totalPoints}
              </span>
            </p>
          )}
        </div>

        {/* Question Text */}
        <MarkdownViewer className="mb-4 pb-4 border-b text-gray-700">
          {questionText}
        </MarkdownViewer>

        {/* Learner's Answer */}
        <div className="flex items-center justify-between mb-4">
          {renderLearnerAnswer()}
        </div>

        {/* Feedback */}
        {highestScoreResponse?.feedback && (
          <div className="p-4 mt-4 rounded-lg bg-gray-50 flex items-center gap-4">
            <div className="flex-shrink-0 w-6 justify-center items-center flex">
              <SparklesIcon className="w-4 h-4 text-violet-600" />
            </div>
            <MarkdownViewer className="text-gray-800 flex-1">
              {highestScoreResponse?.feedback[0]?.feedback}
            </MarkdownViewer>
          </div>
        )}
      </motion.div>
      {selectedFileContent && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">{selectedFileName}</h2>
            <MarkdownViewer className="text-sm whitespace-pre-wrap bg-gray-100 p-4 rounded-md text-gray-600">
              {selectedFileContent}
            </MarkdownViewer>
            <button
              onClick={() => setSelectedFileContent(null)}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Question;
