"use client"
import React, { useState } from 'react';
import Button from './Button';
import Title from './Title';
import InfoLine from './InfoLine';

interface Props {
  questionText: string;
  options: string[];
  points: number;
  onAnswerSelected?: (selectedOption: string) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const { questionText, options, points, onAnswerSelected } = props;
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    if (onAnswerSelected) {
      onAnswerSelected(option);
    }
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md question-container">
      <Title text={`Question 2: Points out of ${points} (${(points / 40) * 100}%)`} />
      <InfoLine text={questionText} />
      <div className="mb-4">
        {options.map((option, index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${selectedOption === option ? 'bg-blue-100' : ''} text-black`} 
            onClick={() => handleOptionClick(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-4">
        <Button text="Previous Question" />
        <Button text="Next Question" />
      </div>
    </div>
  );
}

export default MultipleChoiceQuestion;
