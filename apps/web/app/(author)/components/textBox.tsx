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
  const [questions, setQuestions] = useState<Array<JSX.Element>>([]);
  const [jsonData, setJsonData] = useState<any>(null);
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


  const generateJsonData = () => {
    const data = {
      inputText,
      displayText,
      questionType: selectedQuestionType,
      optionsSingleCorrect,
      selectedOptionSingleCorrect,
      optionsMultipleAnswers,
      selectedOptionsMultipleAnswers,
      writtenQuestionText,
    };

    setJsonData(data);
  };


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

  const handleOptionChangeMultipleAnswers = (index: number, value: string) => {
    const updatedOptions = [...optionsMultipleAnswers];
    updatedOptions[index] = value;
    setOptionsMultipleAnswers(updatedOptions);
  };

  const handleWrittenQuestionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setWrittenQuestionText(event.target.value);
  };

  return (
    <div className="mt-8 pl-2 border border-gray-300 rounded-md p-4" style={{ width: '67.5625rem', height: '31.5rem' }}>
      <button
        className="bg-blue-500 text-white p-2 rounded-md ml-2"
        onClick={generateJsonData}
      >
        Convert to JSON
      </button>
      {jsonData && (
        <div className="mt-4">
          <p>Generated JSON Data:</p>
          <pre className="bg-gray-100 p-2 rounded-md text-black overflow-auto">
            {JSON.stringify(jsonData, null, 2)}
          </pre>
        </div>
      )}
      <div className="text-xl text-black font-inter text-1rem leading-1.25rem mr-2">Question:</div>
      <textarea className="w-full p-2 mb-4 border rounded text-black" placeholder="Type your answer here..." value={inputText} onChange={(e) => handleInputChange} />

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
        <div className="flex items-start gap-0.75rem">
        <button
          className="bg-blue-500 border text-white p-2 rounded-md"
          onClick={handleMenuToggle}
          style={{
            width: '19.125rem',
            height: '3.5rem',
          }}
        >
          {selectedQuestionType
            ? selectedQuestionType === QuestionType.SingleCorrect
              ? 'Single Correct'
              : selectedQuestionType === QuestionType.MultipleAnswers
              ? 'Multiple Answers'
              : 'Written Question'
            : 'Select Question Type'}
        </button>

        {isMenuOpen && (
          <div className="bg-white border rounded-md shadow-md">
            <button
              className={`w-full text-left p-2 ${
                selectedQuestionType === QuestionType.SingleCorrect
                  ? 'bg-gray-200 text-black'
                  : 'text-black'
              }`}
              onClick={() => handleQuestionTypeSelect(QuestionType.SingleCorrect)}
            >
              Single Correct
            </button>
              <button
                className={`w-full text-left p-2 ${
                  selectedQuestionType === QuestionType.MultipleAnswers
                    ? 'bg-gray-200 text-black'
                    : 'text-black'
                }`}
                onClick={() => handleQuestionTypeSelect(QuestionType.MultipleAnswers)}
              >
                Multiple Answers
              </button>
              <button
                className={`w-full text-left p-2 ${
                  selectedQuestionType === QuestionType.WrittenQuestion
                    ? 'bg-gray-200 text-black'
                    : 'text-black'
                }`}
                onClick={() => handleQuestionTypeSelect(QuestionType.WrittenQuestion)}
              >
                Written Question
              </button>
            </div>
          )}
        </div>
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
          <textarea className="w-full p-2 mb-4 border rounded text-black" placeholder="Type your answer here..." value={writtenQuestionText} onChange={(e) => handleWrittenQuestionChange} />
        </div>
      )}
    </div>
  );
}

export default TextBox;