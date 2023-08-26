"use client";

import { Question } from "@/config/types";
import React, { useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  questionData?: Question;
  onAnswerSelected?: (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => void;
}
/* @Bennyli1995 - I just copied the code from MultipleChoiceQuestion
If you have time, please implement the URL question type */
function MultipleChoiceQuestion(props: Props) {
  const { questionData, onAnswerSelected } = props;
  const { question, choices, numRetries, totalPoints } = questionData;
  const [attempts, setAttempts] = useState<number>(0);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

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
  };

  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <InfoLine text={question} />
        {/* TODO @Bennyli1995 - upload here */}
      </div>
      <Button onClick={handleSubmit} disabled={attempts >= numRetries}>
        Submit
      </Button>
    </>
  );
}

export default MultipleChoiceQuestion;
