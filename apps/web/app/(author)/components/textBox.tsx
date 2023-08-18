"use client"
import React, { useState, useEffect, useRef } from 'react';

interface Props {}

enum QuestionType {
  SingleCorrect = 'single_correct',
  MultipleCorrect = 'multiple_correct',
  WrittenQuestion = 'written_question',
}

function TextBox(props: Props) {
  const [inputText, setInputText] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedQuestionType, setSelectedQuestionType] = useState<QuestionType | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [writtenQuestionText, setWrittenQuestionText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  };

  const handleDisplayText = () => {
    setDisplayText(inputText);
  };

  const handleMenuToggle = () => {
    setIsMenuOpen((prevIsMenuOpen) => !prevIsMenuOpen);
  };

  const handleQuestionTypeSelect = (questionType: QuestionType) => {
    setSelectedQuestionType(questionType);
    setIsMenuOpen(false);
    setOptions([]);
    setSelectedOptions([]);
    setWrittenQuestionText('');
  };

  const handleOptionChange = (index: number, value: string) => {
    const updatedOptions = [...options];
    updatedOptions[index] = value;
    setOptions(updatedOptions);
  };

  const handleOptionToggle = (option: string) => {
    if (selectedOptions.includes(option)) {
      setSelectedOptions(selectedOptions.filter((selectedOption) => selectedOption !== option));
    } else {
      setSelectedOptions([...selectedOptions, option]);
    }
  };

  const handleWrittenQuestionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setWrittenQuestionText(event.target.value);
  };

  return (
    <div className="flex flex-col items-center mt-8" style={{ width: '67.5625rem', height: '31.5rem' }}>
      <input
        type="text"
        className="border p-2 rounded-md text-black"
        placeholder="Enter text here"
        value={inputText}
        onChange={handleInputChange}
        style={{ width: '59.15rem', height: '8.6875rem' }}
      />
      <button
        className="mt-2 bg-blue-500 text-white p-2 rounded-md"
        onClick={handleDisplayText}
      >
        Display Text
      </button>
      {displayText && (
        <div className="mt-4">
          <p>Displayed Text:</p>
          <p className="bg-gray-100 p-2 rounded-md text-black">{displayText}</p>
        </div>
      )}
      <div className="mt-4 relative" ref={menuRef}>
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={handleMenuToggle}
        >
          Select Question Type
        </button>
        {isMenuOpen && (
          <div className="absolute top-10 right-0 bg-white border rounded-md shadow-md">
            <button
              className={`block w-full text-left p-2 ${selectedQuestionType === QuestionType.SingleCorrect ? 'bg-gray-200 text-black' : 'text-black'}`}
              onClick={() => handleQuestionTypeSelect(QuestionType.SingleCorrect)}
            >
              Single Correct
            </button>
            <button
              className={`block w-full text-left p-2 ${selectedQuestionType === QuestionType.MultipleCorrect ? 'bg-gray-200 text-black' : 'text-black'}`}
              onClick={() => handleQuestionTypeSelect(QuestionType.MultipleCorrect)}
            >
              Multiple Correct
            </button>
            <button
              className={`block w-full text-left p-2 ${selectedQuestionType === QuestionType.WrittenQuestion ? 'bg-gray-200 text-black' : 'text-black'}`}
              onClick={() => handleQuestionTypeSelect(QuestionType.WrittenQuestion)}
            >
              Written Question
            </button>
          </div>
        )}
      </div>
      {selectedQuestionType === QuestionType.SingleCorrect || selectedQuestionType === QuestionType.MultipleCorrect ? (
        <div className="mt-4">
          <p>Options:</p>
          {options.map((option, index) => (
            <div key={index} className="flex items-center">
              {selectedQuestionType === QuestionType.MultipleCorrect ? (
                <input
                  type="checkbox"
                  value={option}
                  checked={selectedOptions.includes(option)}
                  onChange={() => handleOptionToggle(option)}
                />
              ) : (
                <input
                  type="radio"
                  name="singleCorrectOption"
                  value={option}
                  checked={selectedOptions.includes(option)}
                  onChange={() => handleOptionToggle(option)}
                />
              )}
              <input
                type="text"
                className="border ml-2 p-2 rounded-md text-black"
                placeholder={`Option ${index + 1}`}
                value={option}
                onChange={(event) => handleOptionChange(index, event.target.value)}
              />
              <button
                className="ml-2 text-red-600"
                onClick={() => {
                  const updatedOptions = [...options];
                  updatedOptions.splice(index, 1);
                  setOptions(updatedOptions);
                }}
              >
                X
              </button>
            </div>
          ))}
          <button
            className="bg-blue-500 text-white p-2 rounded-md mt-2"
            onClick={() => setOptions([...options, ''])}
          >
            Add Option
          </button>
        </div>
      ) : null}
      {selectedQuestionType === QuestionType.WrittenQuestion && (
        <div className="mt-4">
          <p>Written Question:</p>
          <input
            type="text"
            className="border p-2 rounded-md text-black"
            placeholder="Enter your question"
            value={writtenQuestionText}
            onChange={handleWrittenQuestionChange}
          />
        </div>
      )}
    </div>
  );
}

export default TextBox;
