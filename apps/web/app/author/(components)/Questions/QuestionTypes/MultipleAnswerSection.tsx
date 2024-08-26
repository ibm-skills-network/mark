"use client";

import { Choice as ChoiceType } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import React, { useEffect, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import QuestionNumberOfRetries from "../../QuestionNumberOfRetries";
import Choice from "./Choice";

interface sectionProps {
  questionId: number;
}

function Section(props: sectionProps) {
  const { questionId } = props;

  const [
    questions,
    modifyQuestion,
    addChoice,
    removeChoice,
    setChoices,
    toggleChoice,
    modifyChoice,
    setPoints,
  ] = useAuthorStore((state) => [
    state.questions,
    state.modifyQuestion,
    state.addChoice,
    state.removeChoice,
    state.setChoices,
    state.toggleChoice,
    state.modifyChoice,
    state.setPoints,
  ]);

  const numOfTimeSuggestionHasBeenShown =
    ~~localStorage.getItem("numOfTimeSuggestionHasBeenShown") || 0;

  const question = questions.find((question) => question.id === questionId);
  const { choices, totalPoints: points, numRetries: retries } = question;
  useEffect(() => {
    // if choices is empty, add a default choice
    if (!choices) {
      setChoices(questionId, [
        {
          choice: "",
          isCorrect: false,
          points: 1,
        },
      ]);
    }
  }, []);
  const [parent, enableAnimations] = useAutoAnimate();
  if (!choices) {
    return null;
  }
  // keys are the choices, values are booleans
  const keys = Object.keys(choices);
  const disableAddChoice = keys.length >= 10 || keys.some((key) => key === "");

  function handleChoiceChange(
    choiceIndex: number,
    choice: Partial<ChoiceType>,
  ) {
    modifyChoice(questionId, choiceIndex, choice);
  }

  function handleAddChoice() {
    addChoice(questionId);
  }

  function handleRemoveChoice(choiceIndex: number) {
    removeChoice(questionId, choiceIndex);
  }

  function handleChangeChoicePoints(choiceIndex: number, points: number) {
    handleChoiceChange(choiceIndex, { points });
  }

  function handleChangeChoiceText(choiceIndex: number, choiceText: string) {
    handleChoiceChange(choiceIndex, { choice: choiceText });
  }

  function handleChoiceToggle(choiceIndex: number) {
    // check if the choice is correct
    // if it is, then that means that the user is trying to uncheck it
    // in that case, we need to also return the points to 0
    const choice = choices[choiceIndex];
    const { isCorrect } = choice;
    if (isCorrect) {
      // set the points to 0
      // this experience could be improved by getting back the points that the user had before
      handleChangeChoicePoints(choiceIndex, 0);
    }
    toggleChoice(questionId, choiceIndex);
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        <label className="font-medium leading-5 text-gray-800">Choices</label>
        {/* loop throug the key value object */}
        <ul ref={parent} className="">
          {choices.map((choice, index) => (
            <Choice
              key={index}
              index={index}
              choice={choice}
              changeText={handleChangeChoiceText}
              toggleChoice={handleChoiceToggle}
              removeChoice={handleRemoveChoice}
              addChoice={handleAddChoice}
              changePoints={handleChangeChoicePoints}
            />
          ))}
        </ul>
        <button
          type="button"
          disabled={disableAddChoice}
          className="flex mr-auto rounded-full bg-white px-5 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-200 disabled:opacity-50 transition"
          onClick={() => {
            handleAddChoice();
            if (numOfTimeSuggestionHasBeenShown < 3) {
              toast.message(
                "You can also press enter to create a new choice!",
                {
                  position: "bottom-center",
                  duration: 5000,
                  important: true,
                },
              );
              localStorage.setItem(
                "numOfTimeSuggestionHasBeenShown",
                (numOfTimeSuggestionHasBeenShown + 1).toString(),
              );
            }
          }}
        >
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
              whiteSpace: "nowrap", // Prevent text from wrapping
              display: "inline-block", // Ensure it stays on one line
            }}
          >
            Add Option
          </span>
        </button>
      </div>
    </div>
  );
}

export default Section;
