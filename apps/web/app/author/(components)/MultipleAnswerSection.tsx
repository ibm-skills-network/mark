"use client";

import React, { useState } from "react";

interface MultipleAnswerSectionProps {
  optionsMultipleAnswers: string[]; // Replace with the appropriate type
  selectedOptionsMultipleAnswers: string[];
  handleOptionToggleMultipleAnswers: (selected: string) => void; // Replace with the appropriate type
  handleOptionChangeMultipleAnswers: (index: number, value: string) => void;
  setOptionsMultipleAnswers: (options: string[]) => void;
  setSelectedOptionsMultipleAnswers: (selected: string[]) => void;
}

function MultipleAnswerSection(props: MultipleAnswerSectionProps) {
  const {
    optionsMultipleAnswers,
    selectedOptionsMultipleAnswers,
    handleOptionToggleMultipleAnswers,
    handleOptionChangeMultipleAnswers,
    setOptionsMultipleAnswers,
    setSelectedOptionsMultipleAnswers,
  } = props;
  const [pointInputs, setPointInputs] = useState<{ [id: string]: number }>({});

  const [isInputMode, setIsInputMode] = useState(false);
  const [points, setPoints] = useState(0);

  const handleButtonClick = (optionId: string) => {
    setIsInputMode(!isInputMode); // Toggle input mode
    setPoints(pointInputs[optionId] || 0); // Set points based on existing value or default to 0
  };

  const handleInputBlur = (
    event: React.FocusEvent<HTMLInputElement>,
    optionId: string
  ) => {
    const newPoints = parseInt(event.target.value);
    const newPointInputs = { ...pointInputs, [optionId]: newPoints };
    setPointInputs(newPointInputs);
  };

  const [optionChecked, setOptionChecked] = useState<boolean[]>(
    Array(optionsMultipleAnswers.length).fill(false)
  );

  return (
    <div className="mt-4">
      <p>Options:</p>

      {optionsMultipleAnswers.map((option, index) => {
        const optionId = `option_${index}`; // Generate a unique ID for each option
        const isChecked = selectedOptionsMultipleAnswers.includes(optionId);
        const isOptionChecked = optionChecked[index];
        return (
          <div key={optionId} className="flex items-center mb-[5px]">
            <input
              type="checkbox"
              id={optionId}
              checked={isChecked}
              onChange={() => {
                handleOptionToggleMultipleAnswers(optionId);
                const newOptionChecked = [...optionChecked];
                newOptionChecked[index] = !newOptionChecked[index];
                setOptionChecked(newOptionChecked);
              }}
            />
            <div className="ml-2">
              {" "}
              {/* Add margin to create space */}
              {String.fromCharCode(65 + index)}.
            </div>
            <textarea
              className="w-[800px] p-2 rounded-md text-black bg-transparent outline-none" // Removed 'border ml-2' and added 'w-full'
              placeholder={`Option ${index + 1}`}
              value={option}
              onChange={(event) =>
                handleOptionChangeMultipleAnswers(index, event.target.value)
              }
              style={{
                height: "2.0rem", // Changed 'height' to 'minHeight'
                maxWidth: "100%",
                overflow: "hidden",
                resize: "vertical",
              }}
            />
            <button
              className="ml-2 text-red-600"
              onClick={() => {
                const updatedOptions = optionsMultipleAnswers.filter(
                  (_, i) => i !== index
                );
                const updatedSelectedOptions =
                  selectedOptionsMultipleAnswers.filter(
                    (id) => id !== optionId
                  );
                setOptionsMultipleAnswers(updatedOptions);
                setSelectedOptionsMultipleAnswers(updatedSelectedOptions);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
                />
              </svg>
            </button>
            <div className="ml-[5px]">
              <input
                className="w-[80px]"
                type="number"
                autoFocus
                disabled={!isOptionChecked} // Disable input when checkbox is not checked
              />
              <button
                onClick={() => handleButtonClick(optionId)}
                style={{
                  color: isOptionChecked ? "blue-700" : "gray-700",
                  borderColor: "transparent",
                  backgroundColor: "transparent",
                  cursor: isOptionChecked ? "pointer" : "not-allowed", // Set cursor based on checkbox state
                }}
                disabled={!isOptionChecked} // Disable button when checkbox is not checked
              >
                {0} points
              </button>
            </div>
          </div>
        );
      })}
      <div className="mt-[10px]">
        <button
          type="button"
          className="rounded-full w-[140px] bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-200"
          onClick={() =>
            setOptionsMultipleAnswers([...optionsMultipleAnswers, ""])
          }
        >
          <div className="flex items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="21"
              viewBox="0 0 20 21"
              fill="none"
            >
              <path
                d="M11.3438 7.34375C11.3438 7.11997 11.2549 6.90536 11.0966 6.74713C10.9384 6.58889 10.7238 6.5 10.5 6.5C10.2762 6.5 10.0616 6.58889 9.90338 6.74713C9.74515 6.90536 9.65625 7.11997 9.65625 7.34375V10.1562H6.84375C6.61997 10.1562 6.40536 10.2451 6.24713 10.4034C6.08889 10.5616 6 10.7762 6 11C6 11.2238 6.08889 11.4384 6.24713 11.5966C6.40536 11.7549 6.61997 11.8438 6.84375 11.8438H9.65625V14.6562C9.65625 14.88 9.74515 15.0946 9.90338 15.2529C10.0616 15.4111 10.2762 15.5 10.5 15.5C10.7238 15.5 10.9384 15.4111 11.0966 15.2529C11.2549 15.0946 11.3438 14.88 11.3438 14.6562V11.8438H14.1562C14.38 11.8438 14.5946 11.7549 14.7529 11.5966C14.9111 11.4384 15 11.2238 15 11C15 10.7762 14.9111 10.5616 14.7529 10.4034C14.5946 10.2451 14.38 10.1562 14.1562 10.1562H11.3438V7.34375Z"
                fill="#1D4ED8"
              />
            </svg>
            <span style={{ fontSize: "0.8rem", marginLeft: "0.5rem" }}>
              Add Option
            </span>
          </div>
        </button>
      </div>
      <div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
          />
        </svg>
        Warning: in multiple answer - multiple choice, one or more than one
        wrong option in answer would cause 0 points in this question.
      </div>
    </div>
  );
}

export default MultipleAnswerSection;
