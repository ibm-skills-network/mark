"use client"
import React, { useState, useEffect, useRef } from 'react';
import checkmark from './checkmark.svg';

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
      <input
        type="text"
        className="border p-2 rounded-md text-black"
        placeholder="Enter question here"
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
        <div className="flex items-start gap-0.75rem">
        <button
          className="bg-blue-500 border text-white p-2 rounded-md"
          onClick={handleMenuToggle}
          style={{
            width: '19.125rem',
            height: '3.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="23" height="24" viewBox="0 0 23 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11.5" cy="12" r="10.75" stroke="#6B7280" stroke-width="1.5"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5572 9.06597C15.6048 9.10206 15.6448 9.14717 15.6749 9.19872C15.705 9.25027 15.7247 9.30725 15.7327 9.36639C15.7408 9.42554 15.7371 9.48569 15.7218 9.5434C15.7066 9.60111 15.6801 9.65525 15.6438 9.70272L10.7954 16.0582C10.7561 16.1097 10.7062 16.1522 10.6491 16.1828C10.592 16.2134 10.5289 16.2315 10.4642 16.2358C10.3995 16.2401 10.3347 16.2305 10.274 16.2077C10.2133 16.1849 10.1582 16.1494 10.1124 16.1036L7.38518 13.3798C7.30489 13.2938 7.26118 13.1799 7.26325 13.0623C7.26533 12.9447 7.31304 12.8325 7.39631 12.7493C7.47959 12.6662 7.59195 12.6185 7.7097 12.6164C7.82746 12.6144 7.94143 12.658 8.02759 12.7382L10.3876 15.0946L14.9208 9.15252C14.9938 9.05686 15.1018 8.99401 15.2211 8.97779C15.3404 8.96156 15.4613 8.99327 15.5572 9.06597Z" fill="#6B7280" stroke="#6B7280"/>
          </svg>
          <span style={{ marginLeft: '10px' }}>
          {selectedQuestionType
            ? selectedQuestionType === QuestionType.SingleCorrect
              ? 'Single Correct'
              : selectedQuestionType === QuestionType.MultipleAnswers
              ? 'Multiple Answers'
              : 'Written Question'
            : 'Select Question Type'}
          </span>
          </div>
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