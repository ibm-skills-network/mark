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
  // TODO @Bennyli1995 - I will handle the situation where it's a single correct answer
  const { questionData, onAnswerSelected, singleCorrect = false } = props;
  const { question, choices, numRetries, totalPoints } = questionData;
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
        {choices.map((option, index) => {
          // get key from choice
          const choiceText = Object.keys(option)[0];
          const isCorrect = option[choiceText];
          return (
            <button
              key={index}
              className={`block w-full text-left p-2 mb-2 border rounded ${
                submitted
                  ? selectedOptions.includes(choiceText)
                    ? isCorrect
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
          );
        })}
      </div>
      <Button onClick={handleSubmit} disabled={attempts >= numRetries}>
        Submit
      </Button>
      {renderFeedbackMessage()}
      {renderAttemptMessage()}
    </>
  );
}

export default MultipleChoiceQuestion;
