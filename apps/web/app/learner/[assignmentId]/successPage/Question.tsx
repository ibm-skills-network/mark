"use client";

import { motion } from "framer-motion";
import MarkdownViewer from "@/components/MarkdownViewer";
import { useLearnerStore } from "@/stores/learner";
import { getFeedbackColors } from "@/lib/utils";
import type { QuestionStore } from "@/config/types";
import { FC, useMemo } from "react";

interface Props {
  question: QuestionStore;
  number: number;
}

interface HighestScoreResponseType {
  points: number;
  feedback: { feedback: string }[];
}

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
  } = question;
  const showSubmissionFeedback = useLearnerStore(
    (state) => state.showSubmissionFeedback,
  );

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

  // Determine the learner's response, falling back to learnerResponse if it exists in zustand for author
  let learnerResponse: string | string[] | boolean | undefined = undefined;
  if (learnerTextResponse) {
    learnerResponse = learnerTextResponse;
  } else if (learnerUrlResponse) {
    learnerResponse = learnerUrlResponse;
  } else if (learnerAnswerChoice) {
    learnerResponse = learnerAnswerChoice;
  } else if (learnerChoices && learnerChoices.length > 0) {
    learnerResponse = learnerChoices;
  } else if (questionResponse?.learnerResponse) {
    try {
      learnerResponse = JSON.parse(
        questionResponse?.learnerResponse,
      ) as string[];
    } catch (e) {
      learnerResponse = questionResponse?.learnerResponse;
    }
  }

  // Function to display the learner's answer based on the question type
  const renderLearnerAnswer = () => {
    if (type === "TEXT" && learnerResponse) {
      return (
        <MarkdownViewer className="text-gray-800">
          {learnerResponse}
        </MarkdownViewer>
      );
    }
    if (type === "URL" && learnerResponse) {
      return (
        <a
          href={learnerResponse as string}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all"
        >
          {learnerResponse}
        </a>
      );
    }
    if (
      (type === "SINGLE_CORRECT" || type === "MULTIPLE_CORRECT") &&
      Array.isArray(learnerResponse)
    ) {
      return (
        <ul className="list-disc ml-5 text-gray-800">
          {learnerResponse.map((choice: string, idx: number) => (
            <li key={idx} className="font-bold">
              {choice}
            </li>
          ))}
        </ul>
      );
    }
    if (type === "TRUE_FALSE" && learnerResponse !== undefined) {
      return (
        <p className={`text-gray-800 font-bold`}>
          {learnerResponse ? "True" : "False"}
        </p>
      );
    }
    return (
      <p className="text-gray-800">No answer was provided by the learner.</p>
    );
  };

  return (
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
        <div className="bg-gray-50 p-4 rounded-lg">{renderLearnerAnswer()}</div>
      </div>

      {/* Feedback */}
      {highestScoreResponse?.feedback && (
        <div
          className={`p-4 mt-4 rounded-lg ${getFeedbackColors(
            highestScoreResponse.points,
            totalPoints,
          )}`}
        >
          <p className="text-gray-800">
            {highestScoreResponse?.feedback[0]?.feedback}
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default Question;
