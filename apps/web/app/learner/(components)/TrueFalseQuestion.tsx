"use client";

import { Question } from "@/config/types";
import Title from "@components/Title";
import React, { useEffect, useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  // TODO: temporarily made optional(the '?')
  questionData?: Question;
  singleCorrect?: boolean;
  onAnswerSelected?: (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const { questionData, onAnswerSelected, singleCorrect = false } = props;
  const { question, numRetries, totalPoints, answer } = questionData;
  const [attempts, setAttempts] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<boolean | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const handleOptionClick = (option: boolean) => {
    setSubmitted(false);
    setSelectedOption(option);
  };

  const handleSubmit = () => {
    setAttempts((prevAttempts) => prevAttempts + 1);
    setSubmitted(true);

    let status: "correct" | "incorrect" = "incorrect";
    if (selectedOption === answer) {
      status = "correct";
      setIsCorrect(true);
    } else {
      setIsCorrect(false);
    }

    if (onAnswerSelected) {
      onAnswerSelected(status);
    }
  };

  const renderFeedbackMessage = () => {
    if (submitted) {
      if (isCorrect) {
        return <p className="text-green-600">Correct! Well done.</p>;
      } else if (!isCorrect) {
        return (
          <p className="text-red-600">Incorrect choice. Please try again.</p>
        );
      }
    }
    return null;
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
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${
            submitted
              ? selectedOption
                ? isCorrect
                  ? "bg-green-100 text-black"
                  : "bg-red-100 text-black"
                : "text-black"
              : selectedOption
              ? "bg-blue-100 text-black"
              : "text-black"
          }`}
          onClick={() => handleOptionClick(true)}
        >
          true
        </button>
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${
            submitted
              ? selectedOption === false
                ? isCorrect
                  ? "bg-green-100 text-black"
                  : "bg-red-100 text-black"
                : "text-black"
              : selectedOption === false
              ? "bg-blue-100 text-black"
              : "text-black"
          }`}
          onClick={() => handleOptionClick(false)}
        >
          false
        </button>
      </div>
      <Button
        onClick={handleSubmit}
        disabled={attempts >= numRetries}
        className=""
      >
        Submit
      </Button>
      {renderFeedbackMessage()}
      {renderAttemptMessage()}
    </>
  );
}

export default MultipleChoiceQuestion;
