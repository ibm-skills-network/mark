"use client";

import React, { useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";
import Title from "./Title";

interface Props {
  questionText: string;
  options: string[];
  correctOption: string | string[]; // Allow for either a single string or an array of strings (for multiple correct)
  points: number;
  onAnswerSelected?: (selectedOption: string[]) => void; // Updated to accept an array
}

function MultipleChoiceQuestion(props: Props) {
  const { questionText, options, correctOption, points, onAnswerSelected } =
    props;
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  const handleOptionClick = (option: string) => {
    const alreadySelected = selectedOptions.includes(option);
    const newSelectedOptions = alreadySelected
      ? selectedOptions.filter(opt => opt !== option) // Remove the option if already selected
      : [...selectedOptions, option]; // Add the clicked option to the selected options array

    setSelectedOptions(newSelectedOptions);
  };

  const handleSubmit = () => {
    const correct = Array.isArray(correctOption)
      ? selectedOptions.every(opt => correctOption.includes(opt)) && selectedOptions.length === correctOption.length
      : selectedOptions.includes(correctOption);

    setIsCorrect(correct);

    if (onAnswerSelected) {
      onAnswerSelected(selectedOptions);
    }
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md question-container">
      <Title
        text={`Question 2: Points out of ${points} (${(points / 40) * 100}%)`}
      />
      <InfoLine text={questionText} />
      <div className="mb-4">
        {options.map((option, index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              selectedOption === option
                ? isCorrect
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
        <p className={`text-${isCorrect ? 'green' : 'red'}-600`}>
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
