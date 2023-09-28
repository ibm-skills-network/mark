// This is the component that we use to add/delete questions for author, it contains two buttons
// which are "add new textbox" and "delete"
"use client";

import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/solid";
import { useEffect, useRef, useState } from "react";
import TextBox from "./Textbox";

function DynamicTextBoxContainer() {
  const [textBoxes, setTextBoxes] = useState<number[]>([Date.now()]); // Initialize with one textbox

  // click me button for textboxes
  const [scrollTargets, setScrollTargets] = useState([]); // Keep track of scroll targets for each textbox
  const [
    questions,
    setQuestions,
    removeQuestion,
    addQuestion,
    activeAssignmentId,
  ] = useAuthorStore((state) => [
    state.questions,
    state.setQuestions,
    state.removeQuestion,
    state.addQuestion,
    state.activeAssignmentId,
  ]);
  const handleAddTextBox = () => {
    addQuestion({
      id: questions.length + 1,
      assignmentId: activeAssignmentId,
      question: "",
      totalPoints: 0,
      type: "MULTIPLE_CORRECT",
    });
    setScrollTargets((prevTargets) => {
      const newTargets: number[] = [
        ...(prevTargets as number[]),
        questions.length + 1,
      ];
      return newTargets;
    });
  };

  const handleDeleteTextBox = (questionId: number) => {
    // Remove the textbox and its scroll target
    removeQuestion(questionId);

    setScrollTargets((prevTargets: number[]) =>
      prevTargets.filter((target) => target !== questionId)
    );
  };
  const handleScrollToTarget = (questionId: number) => {
    if (typeof questionId !== "number") {
      throw new Error("questionId must be a string");
    }

    // Scroll to the specified target
    const targetElement = document.getElementById(`textbox-${questionId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth" });
    }
  };

  // TODO: duplicate feat

  const [parentMaxPoints, setParentMaxPoints] = useState<number | null>(null);

  // Define a function to receive the maxPoints value from the child component
  const handleMaxPointsChange = (maxPoints: number) => {
    setParentMaxPoints(maxPoints);
  };

  return (
    <>
      <p className="text-center text-gray-500 text-base leading-5 my-8">
        Begin writing the questions for your assignment below.
      </p>
      <div className="flex gap-4 my-4">
        {questions.map((question, index) => (
          <button
            key={index}
            type="button"
            onClick={() => handleScrollToTarget(question.id)}
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
          >
            Click Me {index + 1}
          </button>
        ))}
      </div>
      <div className="mb-24 flex flex-col gap-y-20">
        {questions.map((question, index) => (
          <section key={index} className="flex gap-x-4 mx-auto">
            <div className="sticky">
              <div className="sticky top-10 inline-flex rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold">
                {index + 1}
              </div>
              <div className="sticky top-[100px] text-blue-700 items-center justify-center w-15 h-11 flex flex-row">
                {parentMaxPoints} Points
              </div>
            </div>
            <div id={`textbox-${question.id}`}>
              <TextBox
                question={question}
                onMaxPointsChange={handleMaxPointsChange}
              />
            </div>
            {/* Display the maxPoints value received from the child component */}

            {/* Delete question button */}
            <button
              disabled={questions.length <= 1}
              className="sticky top-10 inline-flex rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handleDeleteTextBox(question.id)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M14.74 9.00003L14.394 18M9.606 18L9.26 9.00003M19.228 5.79003C19.57 5.84203 19.91 5.89703 20.25 5.95603M19.228 5.79003L18.16 19.673C18.1164 20.2383 17.8611 20.7662 17.445 21.1513C17.029 21.5364 16.4829 21.7502 15.916 21.75H8.084C7.5171 21.7502 6.97102 21.5364 6.55498 21.1513C6.13894 20.7662 5.88359 20.2383 5.84 19.673L4.772 5.79003M19.228 5.79003C18.0739 5.61555 16.9138 5.48313 15.75 5.39303M4.772 5.79003C4.43 5.84103 4.09 5.89603 3.75 5.95503M4.772 5.79003C5.92613 5.61555 7.08623 5.48313 8.25 5.39303M15.75 5.39303V4.47703C15.75 3.29703 14.84 2.31303 13.66 2.27603C12.5536 2.24067 11.4464 2.24067 10.34 2.27603C9.16 2.31303 8.25 3.29803 8.25 4.47703V5.39303M15.75 5.39303C13.2537 5.20011 10.7463 5.20011 8.25 5.39303"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </section>
        ))}

        <button
          type="button"
          className="mx-auto rounded-full bg-blue-700 p-2 text-white shadow-sm hover:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={handleAddTextBox}
        >
          <PlusIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

export default DynamicTextBoxContainer;
