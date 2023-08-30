"use client";

import { Question } from "@/config/types"; // Ensure the Question type matches with GetQuestionResponseDto
import Title from "@components/Title";
import React, { useEffect, useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  questionData?: Question;
  onAnswerSelected?: (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const { questionData, onAnswerSelected } = props;

  // Removed 'singleCorrect' since the question type itself implies if it's single or multiple correct
  const { question, choices, numRetries } = questionData!;
  const correctOptions = Object.keys(choices).filter(
    (option) => choices[option]
  );

  const [attempts, setAttempts] = useState<number>(0);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isCorrect, setIsCorrect] = useState<"all" | "some" | "none" | null>(
    null
  );
  const [submitted, setSubmitted] = useState<boolean>(false);

  const handleOptionClick = (option: string) => {
    setSubmitted(false);
    const alreadySelected = selectedOptions.includes(option);
    const newSelectedOptions = alreadySelected
      ? selectedOptions.filter((opt) => opt !== option)
      : [...selectedOptions, option];

    setSelectedOptions(newSelectedOptions);
  };

  const handleSubmit = () => {
    setAttempts((prevAttempts) => prevAttempts + 1);
    setSubmitted(true);

    let correctCount = 0;
    let incorrectCount = 0;

    selectedOptions.forEach((option) => {
      if (correctOptions.includes(option)) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const finalCorrectCount = Math.max(correctCount - incorrectCount, 0);

    let status: "correct" | "incorrect" | "partiallyCorrect" = "incorrect";
    if (
      finalCorrectCount === correctOptions.length &&
      selectedOptions.length === correctOptions.length
    ) {
      status = "correct";
      setIsCorrect("all");
    } else if (finalCorrectCount > 0) {
      status = "partiallyCorrect";
      setIsCorrect("some");
    } else {
      setIsCorrect("none");
    }

    if (onAnswerSelected) {
      onAnswerSelected(status);
    }
  };

  const renderFeedbackMessage = () => {
    let feedbackText = "";
    let bgColor = "";
    let borderColor = "";
    let textColor = "";
    let innerCircleColor = "";

    switch (isCorrect) {
      case "all":
        feedbackText = "Correct! Well done.";
        bgColor = "bg-emerald-100";
        borderColor = "border-emerald-500";
        textColor = "text-emerald-800";
        innerCircleColor = "bg-emerald-400";
        break;
      case "some":
        feedbackText = "Not all correct answers were selected. Try again.";
        bgColor = "bg-yellow-100";
        borderColor = "border-yellow-500";
        textColor = "text-yellow-800";
        innerCircleColor = "bg-yellow-400";
        break;
      case "none":
        feedbackText = "Incorrect choice. Please try again.";
        bgColor = "bg-red-100";
        borderColor = "border-red-500";
        textColor = "text-red-800";
        innerCircleColor = "bg-red-400";
        break;
      default:
        return null;
    }

    return (
      <div
        className={`w-96 h-16 pl-2 pr-2.5 py-0.5 ${bgColor} rounded-lg ${borderColor} justify-center items-center gap-1.5 inline-flex`}
      >
        <div className="w-2 h-2 relative">
          <div
            className={`w-1.5 h-1.5 left-[1px] top-[1px] absolute ${innerCircleColor} rounded-full`}
          />
        </div>
        <div
          className={`text-center ${textColor} text-base font-medium leading-none`}
        >
          {feedbackText}
        </div>
      </div>
    );
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
        {/* Used Object.entries() for iteration instead of mapping over 'choices' directly */}
        {Object.entries(choices).map(([choiceText, isChoiceCorrect], index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              submitted
                ? selectedOptions.includes(choiceText)
                  ? isChoiceCorrect
                    ? "bg-green-100 text-black"
                    : "bg-red-100 text-black"
                  : "text-black"
                : selectedOptions.includes(choiceText)
                ? "bg-blue-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleOptionClick(choiceText)}
          >
            {choiceText}
          </button>
        ))}
      </div>
      {renderFeedbackMessage()}
      {renderAttemptMessage()}
      <Button onClick={handleSubmit} disabled={attempts >= numRetries}>
        Submit
      </Button>
    </>
  );
}

export default MultipleChoiceQuestion;
