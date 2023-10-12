"use client";

import type { Choices } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import React, { useEffect, useState } from "react";
import Choice from "./Choice";

interface sectionProps {
  questionId: number;
}

function Section(props: sectionProps) {
  const { questionId } = props;

  const [
    questions,
    addChoice,
    removeChoice,
    setChoices,
    toggleChoice,
    modifyChoice,
  ] = useAuthorStore((state) => [
    state.questions,
    state.addChoice,
    state.removeChoice,
    state.setChoices,
    state.toggleChoice,
    state.modifyChoice,
  ]);

  function handleChoiceToggle(choiceId: string) {
    toggleChoice(questionId, choiceId);
  }

  function handleChoiceChange(index: number, value: string) {
    console.log("handleChoiceChange", index, value);
    modifyChoice(questionId, index, value);
  }

  function handleAddChoice() {
    addChoice(questionId, "");
  }

  function handleRemoveChoice(choice: string) {
    removeChoice(questionId, choice);
  }

  const question = questions.find((question) => question.id === questionId);
  const { choices } = question;
  useEffect(() => {
    // if choices is empty, add a default choice
    console.log(choices);
    if (!choices) {
      setChoices(questionId, {
        "This is a default choice": true,
        "This is another default choice": false,
        "One last default choice": true,
      });
    }
    console.log(choices);
  }, []);

  const [pointInputs, setPointInputs] = useState<{ [id: string]: number }>({});

  const [isInputMode, setIsInputMode] = useState(false);
  const [points, setPoints] = useState(0);

  const handleButtonClick = (choiceId: string) => {
    setIsInputMode(true);
    setPoints(pointInputs[choiceId] || 0); // Set points based on existing value or default to 0
  };

  const handleInputBlur = (
    event: React.FocusEvent<HTMLInputElement>,
    choiceId: string
  ) => {
    const newPoints = ~~event.target.value;
    const newPointInputs = { ...pointInputs, [choiceId]: newPoints };
    setPointInputs(newPointInputs);
  };

  if (!choices) {
    return null;
  }

  return (
    <div className="mt-4">
      <p>Choices</p>
      {Object.entries(choices)?.map(([choice, isChecked], index) => (
        <Choice
          key={index}
          index={index}
          choice={choice}
          isChecked={isChecked}
          modifyChoice={handleChoiceChange}
          toggleChoice={handleChoiceToggle}
          removeChoice={handleRemoveChoice}
        />
      ))}
      <div className="">
        <button
          type="button"
          className="rounded-full w-[160px] bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-200"
          onClick={handleAddChoice}
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
            <span
              style={{
                fontSize: "0.8rem",
                marginLeft: "0.5rem",
                whiteSpace: "nowrap", // Prevent text from wrapping
                display: "inline-block", // Ensure it stays on one line
              }}
            >
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
          strokeWidth="1.5"
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
          />
        </svg>
        Warning: in multiple answer - multiple choice, one or more than one
        wrong choice in answer would cause 0 points in this question.
      </div>
    </div>
  );
}

export default Section;
