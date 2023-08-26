"use client";

import Title from "@components/Title";
import React, { useEffect, useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  maxAttempts: number;
  questionNumber: number;
  questionText: string;
  options: string[];
  correctOptions: string[];
  points: number;
  onAnswerSelected?: (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const {
    questionNumber,
    questionText,
    options,
    correctOptions,
    onAnswerSelected,
  } = props;
  const [attempts, setAttempts] = useState<number>(0);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isCorrect, setIsCorrect] = useState<"all" | "some" | "none" | null>(
    null
  );
  const [pointsEarned, setPointsEarned] = useState<number>(0);
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
    const points = (finalCorrectCount / correctOptions.length) * 100;
    setPointsEarned(points);

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
    if (isCorrect === "all") {
      return <p className="text-green-600">Correct! Well done.</p>;
    }
    if (isCorrect === "some") {
      return (
        <p className="text-yellow-600">
          Not all correct answers were selected. Try again.
        </p>
      );
    }
    if (isCorrect === "none") {
      return (
        <p className="text-red-600">Incorrect choice. Please try again.</p>
      );
    }
    return null;
  };

  const renderAttemptMessage = () => {
    if (attempts >= props.maxAttempts) {
      return (
        <p className="text-red-600">
          You have exhausted your attempts for this question.
        </p>
      );
    } else if (attempts > 0) {
      return (
        <p className="text-yellow-600">
          You have used {attempts} of {props.maxAttempts} attempts.
        </p>
      );
    }
    return null;
  };

  return (
    <div
      className="p-8 rounded-lg shadow-md question-container"
      style={{ height: "500px", overflowY: "auto" }}
    >
      <Title
        text={`Question ${questionNumber}: Points ${pointsEarned.toFixed(
          2
        )} out of 100`}
      />
      <InfoLine text={questionText} />
      <div className="mb-4">
        {options.map((option, index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              submitted
                ? selectedOptions.includes(option)
                  ? correctOptions.includes(option)
                    ? "bg-green-100 text-black"
                    : "bg-red-100 text-black"
                  : "text-black"
                : selectedOptions.includes(option)
                ? "bg-blue-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleOptionClick(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <Button onClick={handleSubmit} disabled={attempts >= props.maxAttempts}>
        Submit
      </Button>
      <renderAttemptMessage />
      {renderAttemptMessage()}
    </div>
  );
}

export default MultipleChoiceQuestion;
