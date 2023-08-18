"use client"
import React, { useState, useEffect, useRef } from 'react';

enum QuestionType {
  SingleCorrect = 'single_correct',
  MultipleAnswers = 'multiple_answers',
  WrittenQuestion = 'written_question',
}

function TextBox() {
  const [inputText, setInputText] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedQuestionType, setSelectedQuestionType] = useState<QuestionType | null>(null);
  const [optionsSingleCorrect, setOptionsSingleCorrect] = useState<string[]>([]);
  const [selectedOptionSingleCorrect, setSelectedOptionSingleCorrect] = useState<string | null>(null);
  const [optionsMultipleAnswers, setOptionsMultipleAnswers] = useState<string[]>([]);
  const [selectedOptionsMultipleAnswers, setSelectedOptionsMultipleAnswers] = useState<string[]>([]);
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
    setOptionsSingleCorrect([]);
    setSelectedOptionSingleCorrect(null);
    setWrittenQuestionText('');
  };

  const handleOptionChangeSingleCorrect = (index: number, value: string) => {
    const updatedOptions = [...optionsSingleCorrect];
    updatedOptions[index] = value;
    setOptionsSingleCorrect(updatedOptions);
  };

  const handleOptionToggleSingleCorrect = (index: number) => {
    setSelectedOptionSingleCorrect((prevSelectedOption) => {
      return prevSelectedOption === optionsSingleCorrect[index] ? null : optionsSingleCorrect[index];
    });
  };

  const handleOptionToggleMultipleAnswers = (option: string) => {
    setSelectedOptionsMultipleAnswers((prevSelectedOptions) => {
      if (prevSelectedOptions.includes(option)) {
        return prevSelectedOptions.filter((selectedOption) => selectedOption !== option);
      } else {
        return [...prevSelectedOptions, option];
      }
    });
  };

  const handleWrittenQuestionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setWrittenQuestionText(event.target.value);
  };

  return (
    <div className="mt-8 pl-2" style={{ width: '67.5625rem', height: '31.5rem' }}>
      <div className="text-xl text-black font-inter text-1rem leading-1.25rem mr-2">Question:</div>
      <input
        type="text"
        className="border p-2 rounded-md text-black"
        placeholder="Enter text here"
        value={inputText}
        onChange={handleInputChange}
        style={{ width: '59.15rem', height: '8.6875rem' }}
      />
      <div className="mt-2">
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={handleDisplayText}
        >
          Display Text
        </button>
      </div>
      {displayText && (
        <div className="mt-4">
          <p>Displayed Text:</p>
          <p className="bg-gray-100 p-2 rounded-md text-black">{displayText}</p>
        </div>
      )}
      <div className="text-xl text-black font-inter text-1rem leading-1.25rem mr-2">Question type:</div>
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
              className={`block w-full text-left p-2 ${selectedQuestionType === QuestionType.MultipleAnswers ? 'bg-gray-200 text-black' : 'text-black'}`}
              onClick={() => handleQuestionTypeSelect(QuestionType.MultipleAnswers)}
            >
              Multiple Answers
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
      {selectedQuestionType === QuestionType.SingleCorrect ? (
        <div className="mt-4">
          <p>Options:</p>
          {optionsSingleCorrect.map((option, index) => (
            <div key={index} className="flex items-center">
              <input
                type="radio"
                name="singleCorrectOption"
                value={option}
                checked={option === selectedOptionSingleCorrect}
                onChange={() => handleOptionToggleSingleCorrect(index)}
              />
              <input
                type="text"
                className="border ml-2 p-2 rounded-md text-black"
                placeholder={`Option ${index + 1}`}
                value={option}
                onChange={(event) => handleOptionChangeSingleCorrect(index, event.target.value)}
              />
              <button
                className="ml-2 text-red-600"
                onClick={() => {
                  const updatedOptions = [...optionsSingleCorrect];
                  updatedOptions.splice(index, 1);
                  setOptionsSingleCorrect(updatedOptions);
                }}
              >
                X
              </button>
            </div>
          ))}
          <button
            className="bg-blue-500 text-white p-2 rounded-md mt-2"
            onClick={() => setOptionsSingleCorrect([...optionsSingleCorrect, ''])}
          >
            Add Option
          </button>
        </div>
      ) : null}
      {selectedQuestionType === QuestionType.MultipleAnswers ? (
        <div className="mt-4">
          <p>Options:</p>
          {optionsMultipleAnswers.map((option, index) => {
            const optionId = `option_${index}`; // Generate a unique ID for each option
            return (
              <div key={optionId} className="flex items-center">
                <input
                  type="checkbox"
                  id={optionId}
                  checked={selectedOptionsMultipleAnswers.includes(optionId)}
                  onChange={() => handleOptionToggleMultipleAnswers(optionId)}
                />
                <input
                  type="text"
                  className="border ml-2 p-2 rounded-md text-black"
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  onChange={(event) => handleOptionChangeMultipleAnswers(index, event.target.value)}
                />
                <button
                  className="ml-2 text-red-600"
                  onClick={() => {
                    const updatedOptions = optionsMultipleAnswers.filter((_, i) => i !== index);
                    const updatedSelectedOptions = selectedOptionsMultipleAnswers.filter(id => id !== optionId);
                    setOptionsMultipleAnswers(updatedOptions);
                    setSelectedOptionsMultipleAnswers(updatedSelectedOptions);
                  }}
                >
                  X
                </button>
              </div>
            );
          })}

          <button
            className="bg-blue-500 text-white p-2 rounded-md mt-2"
            onClick={() => setOptionsMultipleAnswers([...optionsMultipleAnswers, ''])}
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