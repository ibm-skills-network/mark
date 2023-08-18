"use client"
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
  const { questionText, options, correctOptions, onAnswerSelected } = props;
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isCorrect, setIsCorrect] = useState<'all' | 'some' | 'none' | null>(null);
  const [pointsEarned, setPointsEarned] = useState<number>(0);
  const [submitted, setSubmitted] = useState<boolean>(false); // To control color change

  const handleOptionClick = (option: string) => {
    setSubmitted(false); // Reset submitted status on new selection
    const alreadySelected = selectedOptions.includes(option);
    const newSelectedOptions = alreadySelected
      ? selectedOptions.filter((opt) => opt !== option)
      : [...selectedOptions, option];

    setSelectedOptions(newSelectedOptions);
  };

  const handleSubmit = () => {
    setSubmitted(true); // Mark as submitted
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

    const allCorrectAnswersSelected =
      finalCorrectCount === correctOptions.length;
    const someCorrectAnswersSelected =
      finalCorrectCount > 0 && finalCorrectCount < correctOptions.length;

    if (allCorrectAnswersSelected) {
      setIsCorrect('all');
    } else if (someCorrectAnswersSelected) {
      setIsCorrect('some');
    } else {
      setIsCorrect('none');
    }

    if (onAnswerSelected) {
      onAnswerSelected(selectedOptions);
    }
  };

  const renderFeedbackMessage = () => {
    if (isCorrect === 'all') {
      return <p className="text-green-600">Correct! Well done.</p>;
    }
    if (isCorrect === 'some') {
      return <p className="text-yellow-600">Not all correct answers were selected. Try again.</p>;
    }
    if (isCorrect === 'none') {
      return <p className="text-red-600">Incorrect choice. Please try again.</p>;
    }
    return null;
  };

  return (
    <div className="p-8 bg-white rounded-lg shadow-md question-container">
      <Title text={`Question: Points ${pointsEarned.toFixed(2)} out of 100`} />
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
      <Button text="Submit" onClick={handleSubmit} />
      {renderFeedbackMessage()}
      <div className="flex justify-between mt-4">
        <Button text="Previous Question" />
        <Button text="Next Question" />
      </div>
    </div>
  );
}

export default MultipleChoiceQuestion;
