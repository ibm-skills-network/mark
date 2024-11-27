"use client";

import MarkdownViewer from "@/components/MarkdownViewer";
import type { QuestionStore } from "@/config/types";
import { getFeedbackColors, parseLearnerResponse } from "@/lib/utils";
import { useLearnerStore } from "@/stores/learner";
import { motion } from "framer-motion";
import { FC, useMemo, useState } from "react";

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
      Array.isArray(learnerResponse)
    ) {
      return (
        <ul className="list-disc ml-5 text-gray-800">
          {(learnerResponse as string[]).map((choice: string, idx: number) => (
            <li key={idx} className="font-bold">
              {choice}
            </li>
          ))}
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
        <MarkdownViewer className="mb-4 text-gray-700">
          {questionText}
        </MarkdownViewer>

        {/* Learner's Answer */}
        <div className="mb-4">
          <p className="font-medium text-gray-700 mb-2">Your Answer:</p>
          <div className="bg-gray-50 p-4 rounded-lg">
            {renderLearnerAnswer()}
          </div>
        </div>

        {/* Feedback */}
        {highestScoreResponse?.feedback && (
          <div
            className={`p-4 mt-4 rounded-lg ${getFeedbackColors(
              highestScoreResponse.points,
              totalPoints,
            )}`}
          >
            <MarkdownViewer>
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
