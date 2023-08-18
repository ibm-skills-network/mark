"use client";

import React, { useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";
import Title from "./Title";

interface Props {
  questionText: string;
  options: string[];
  correctOptions: string[]; // Accepting only an array of correct answers
  points: number;
  onAnswerSelected?: (selectedOptions: string[]) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const { questionText, options, correctOptions, points, onAnswerSelected } =
    props;
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]); // Store selected options
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  const handleOptionClick = (option: string) => {
    const alreadySelected = selectedOptions.includes(option);
    const newSelectedOptions = alreadySelected
      ? selectedOptions.filter((opt) => opt !== option)
      : [...selectedOptions, option];

    setSelectedOptions(newSelectedOptions);
  };

  const handleSubmit = () => {
    const correct =
      selectedOptions.every((opt) => correctOptions.includes(opt)) &&
      selectedOptions.length === correctOptions.length;

    setIsCorrect(correct);

    if (onAnswerSelected) {
      onAnswerSelected(selectedOptions);
    }
  };
  return (
    <div className="p-8 bg-white rounded-lg shadow-md question-container">
      <Title text={`Question: Points out of ${points} (${(points / 40) * 100}%)`} />
      <InfoLine text={questionText} />
      <div className="mb-4">
        {options.map((option, index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              selectedOptions.includes(option)
                ? isCorrect === null
                  ? "bg-blue-100 text-black"
                  : correctOptions.includes(option)
                  ? "bg-green-100 text-black"
                  : "bg-red-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleOptionClick(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <Button text="Submit" onClick={handleSubmit} />
      {isCorrect !== null && (
          <p className={isCorrect ? "text-green-600" : "text-red-600"}>
          {isCorrect ? "Correct! Well done." : "Incorrect choice. Please try again."}
        </p>
      )}
      <div className="flex justify-between mt-4">
        <Button text="Previous Question" />
        <Button text="Next Question" />
      </div>
    </div>
  );  
}

export default MultipleChoiceQuestion;
