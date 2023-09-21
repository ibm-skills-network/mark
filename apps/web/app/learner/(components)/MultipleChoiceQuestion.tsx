"use client";

import type {
  QuestionAttemptRequest,
  QuestionStatus,
  QuestionStore,
} from "@/config/types";
// Ensure the Question type matches with GetQuestionResponseDto

import { submitQuestionResponse } from "@/lib/talkToBackend";
import { useLearnerStore } from "@/stores/learner";
import Title from "@components/Title";
import React, { useEffect, useState } from "react";
import Button from "./Button";
import { FeedbackMessage } from "./FeedbackMessage";
import InfoLine from "./InfoLine";

interface Props {
  // this Id is required but not received from Questiondata (for talking to backend upon attempt)
  attemptId?: number;
  updateStatus?: (status: QuestionStatus) => void;
  questionData?: QuestionStore;
}

function MultipleChoiceQuestion(props: Props) {
  const { questionData, attemptId, updateStatus } = props;

  // CHANGE: Removed 'singleCorrect' comment since the question type itself implies if it's single or multiple correct
  const { question, choices, numRetries, type, id } = questionData;

  const correctChoices = choices
    .filter((choiceObj) => choiceObj[Object.keys(choiceObj)[0]])
    .map((choiceObj) => Object.keys(choiceObj)[0]);

  const [attempts, setAttempts] = useState<number>(0);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [isCorrect, setIsCorrect] = useState<"all" | "some" | "none" | null>(
    null
  );
  const [submitted, setSubmitted] = useState<boolean>(false);

  const assignmentId = useLearnerStore((state) => state.activeAssignmentId);

  const handleChoiceClick = (choice: string) => {
    setSubmitted(false);

    if (type === "SINGLE_CORRECT") {
      setSelectedChoices([choice]);
    } else {
      const alreadySelected = selectedChoices.includes(choice);
      const newSelectedChoices = alreadySelected
        ? selectedChoices.filter((opt) => opt !== choice)
        : [...selectedChoices, choice];

      setSelectedChoices(newSelectedChoices);
    }
  };

  // For talking to backend upon attempt
  const handleSubmit = async () => {
    const QuestionResponse: QuestionAttemptRequest = {
      learnerChoices: selectedChoices,
    };
    const success = await submitQuestionResponse(
      assignmentId,
      attemptId,
      id,
      QuestionResponse
    );
    if (!success) {
      console.error("Error submitting the answer");
    }

    setAttempts((prevAttempts) => prevAttempts + 1);
    setSubmitted(true);

    let correctCount = 0;
    let incorrectCount = 0;

    selectedChoices.forEach((choice) => {
      if (correctChoices.includes(choice)) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const finalCorrectCount = Math.max(correctCount - incorrectCount, 0);

    let status: "correct" | "incorrect" | "partiallyCorrect" = "incorrect";
    if (
      finalCorrectCount === correctChoices.length &&
      selectedChoices.length === correctChoices.length
    ) {
      status = "correct";
      setIsCorrect("all");
    } else if (finalCorrectCount > 0) {
      status = "partiallyCorrect";
      setIsCorrect("some");
    } else {
      setIsCorrect("none");
    }

    if (updateStatus) {
      updateStatus(status);
    }
  };

  const renderAttemptMessage = () => {
    if (attempts >= numRetries) {
      return (
        <p className="text-red-600">
          You have exhausted your attempts for this question.
        </p>
      );
    } else if (attempts > 0) {
      return (
        <p className="text-yellow-600">
          You have used {attempts} of {numRetries} attempts.
        </p>
      );
    }
    return null;
  };

  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <InfoLine text={question} />

        {choices.map((choiceObj, index) => {
          const choiceText = Object.keys(choiceObj)[0];
          const isChoiceCorrect = choiceObj[choiceText];
          return (
            <button
              key={index}
              className={`block w-full text-left p-2 mb-2 border rounded ${
                submitted
                  ? selectedChoices.includes(choiceText)
                    ? isChoiceCorrect
                      ? "bg-green-100 text-black"
                      : "bg-red-100 text-black"
                    : "text-black"
                  : selectedChoices.includes(choiceText)
                  ? "bg-blue-100 text-black"
                  : "text-black"
              }`}
              onClick={() => handleChoiceClick(choiceText)}
            >
              {choiceText}
            </button>
          );
        })}

        {/* Feedback and attempts messages */}
        <div className="mt-4 flex flex-col items-center">
          <div className="text-center">
            <FeedbackMessage />
          </div>
          <div className="mt-2 text-center">{renderAttemptMessage()}</div>

          {/* Submit Button */}
          <div className="mt-4">
            <Button
              onClick={handleSubmit}
              disabled={attempts >= numRetries}
              className="disabled:bg-white disabled:text-indigo-300 disabled:cursor-not-allowed hover:bg-indigo-500"
            >
              Submit Question
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default MultipleChoiceQuestion;
