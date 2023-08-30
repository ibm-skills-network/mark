"use client";

import { Question } from "@/config/types";
import Title from "@components/Title";
import React, { useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  questionData?: Question;
  onAnswerSelected?: (status: "correct" | "incorrect") => void;
}

function TrueFalseQuestion(props: Props) {
  const { questionData, onAnswerSelected } = props;
  const { question, answer } = questionData!;

  const [selectedOption, setSelectedOption] = useState<boolean | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const handleOptionClick = (option: boolean) => {
    if (!submitted) {
      setSelectedOption(option);
    }
  };

  const handleSubmit = () => {
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
      return isCorrect ? (
        <p className="text-green-600">Correct! Well done.</p>
      ) : (
        <p className="text-red-600">Incorrect choice.</p>
      );
    }
    return null;
  };

  const buttonStyle = (choice: boolean) => {
    if (submitted) {
      if (selectedOption === choice) {
        return choice === answer
          ? "bg-green-100 text-black"
          : "bg-red-100 text-black";
      }
    } else {
      if (selectedOption === choice) {
        return "bg-blue-100 text-black";
      }
    }
    return "text-black";
  };

  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <InfoLine text={question} />
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
            true
          )}`}
          onClick={() => handleOptionClick(true)}
          disabled={submitted}
        >
          True
        </button>
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
            false
          )}`}
          onClick={() => handleOptionClick(false)}
          disabled={submitted}
        >
          False
        </button>
      </div>
      <Button onClick={handleSubmit} disabled={submitted}>
        Submit
      </Button>
      {renderFeedbackMessage()}
    </>
  );
}

export default TrueFalseQuestion;
