// This is the component that we use to add/delete questions for author, it contains two buttons
// which are "add new textbox" and "delete"
"use client";

import { initialCriteria } from "@/config/constants";
import { getAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/solid";
import { useEffect, useState } from "react";
import TextBox from "./Textbox";

interface Props {
  assignmentId: number;
  defaultQuestionRetries: number;
}
function DynamicTextBoxContainer(props: Props) {
  const { assignmentId, defaultQuestionRetries } = props;
  // const [textBoxes, setTextBoxes] = useState<number[]>([Date.now()]); // Initialize with one textbox

  // click me button for textboxes
  // const [scrollTargets, setScrollTargets] = useState([]); // Keep track of scroll targets for each textbox
  const [
    questions,
    setQuestions,
    removeQuestion,
    addQuestion,
    activeAssignmentId,
    setActiveAssignmentId,
    setAssignmentTitle,
  ] = useAuthorStore((state) => [
    state.questions,
    state.setQuestions,
    state.removeQuestion,
    state.addQuestion,
    state.activeAssignmentId,
    state.setActiveAssignmentId,
    state.setAssignmentTitle,
  ]);

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // check if we have the assignment details in the store
    // if not, call the backend to get the assignment details
    if (assignmentId !== activeAssignmentId) {
      (async () => {
        const assignment = await getAssignment(assignmentId);
        if (assignment) {
          setActiveAssignmentId(assignmentId);
          // update the state of the introduction page with the assignment details from the backend
          setAssignmentTitle(assignment.name || "Untitled Assignment");
          setQuestions(
            assignment.questions
              ?.map((question) => {
                return {
                  ...question,
                  alreadyInBackend: true,
                  scoring: {
                    // TODO: hardcoded for now but we need to find a way to add the type
                    type: "CRITERIA_BASED",
                    ...question.scoring,
                  },
                };
              })
              .sort((a, b) => a.id - b.id) || []
          );
        } else {
          //
        }
      })().catch((err) => {
        console.log("err", err);
      });
    }
  }, []);
  const handleAddTextBox = () => {
    addQuestion({
      id: (questions.slice(-1)[0]?.id || 0) + 1,
      assignmentId: activeAssignmentId,
      question: "",
      totalPoints: 0,
      numRetries: defaultQuestionRetries || 1,
      // TODO: get the type from the dropdown
      type: "TEXT",
      alreadyInBackend: false,
      scoring: {
        type: "CRITERIA_BASED",
        criteria: initialCriteria,
      },
    });
    // setScrollTargets((prevTargets) => {
    //   const newTargets: number[] = [
    //     ...(prevTargets as number[]),
    //     questions.length + 1,
    //   ];
    //   return newTargets;
    // });
  };

  const handleDeleteTextBox = (questionId: number) => {
    // Remove the textbox and its scroll target
    removeQuestion(questionId);

    // setScrollTargets((prevTargets: number[]) =>
    //   prevTargets.filter((target) => target !== questionId)
    // );
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

  return (
    <>
      {/* breakdown */}
      <div
        className="z-40 sticky top-0 border-b border-gray-300"
        style={{ width: "100%", height: "36px", background: "white" }}
      >
        <div className="flex gap-4 my-0 justify-end">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex w-[150px] justify-center gap-x-1.5 border-transparent bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-inset ring-gray-300 hover:bg-gray-50"
            id="menu-button"
            aria-expanded={isOpen} // Set aria-expanded to the value of isOpen
            aria-haspopup="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M5.99999 4.75C5.99999 4.55109 6.07901 4.36032 6.21966 4.21967C6.36031 4.07902 6.55108 4 6.74999 4H17.25C17.4489 4 17.6397 4.07902 17.7803 4.21967C17.921 4.36032 18 4.55109 18 4.75C18 4.94891 17.921 5.13968 17.7803 5.28033C17.6397 5.42098 17.4489 5.5 17.25 5.5H6.74999C6.55108 5.5 6.36031 5.42098 6.21966 5.28033C6.07901 5.13968 5.99999 4.94891 5.99999 4.75ZM5.99999 10C5.99999 9.80109 6.07901 9.61032 6.21966 9.46967C6.36031 9.32902 6.55108 9.25 6.74999 9.25H17.25C17.4489 9.25 17.6397 9.32902 17.7803 9.46967C17.921 9.61032 18 9.80109 18 10C18 10.1989 17.921 10.3897 17.7803 10.5303C17.6397 10.671 17.4489 10.75 17.25 10.75H6.74999C6.55108 10.75 6.36031 10.671 6.21966 10.5303C6.07901 10.3897 5.99999 10.1989 5.99999 10ZM5.99999 15.25C5.99999 15.0511 6.07901 14.8603 6.21966 14.7197C6.36031 14.579 6.55108 14.5 6.74999 14.5H17.25C17.4489 14.5 17.6397 14.579 17.7803 14.7197C17.921 14.8603 18 15.0511 18 15.25C18 15.4489 17.921 15.6397 17.7803 15.7803C17.6397 15.921 17.4489 16 17.25 16H6.74999C6.55108 16 6.36031 15.921 6.21966 15.7803C6.07901 15.6397 5.99999 15.4489 5.99999 15.25ZM1.98999 4.75C1.98999 4.48478 2.09535 4.23043 2.28288 4.04289C2.47042 3.85536 2.72477 3.75 2.98999 3.75H2.99999C3.26521 3.75 3.51956 3.85536 3.7071 4.04289C3.89463 4.23043 3.99999 4.48478 3.99999 4.75V4.76C3.99999 5.02522 3.89463 5.27957 3.7071 5.46711C3.51956 5.65464 3.26521 5.76 2.99999 5.76H2.98999C2.72477 5.76 2.47042 5.65464 2.28288 5.46711C2.09535 5.27957 1.98999 5.02522 1.98999 4.76V4.75ZM1.98999 15.25C1.98999 14.9848 2.09535 14.7304 2.28288 14.5429C2.47042 14.3554 2.72477 14.25 2.98999 14.25H2.99999C3.26521 14.25 3.51956 14.3554 3.7071 14.5429C3.89463 14.7304 3.99999 14.9848 3.99999 15.25V15.26C3.99999 15.5252 3.89463 15.7796 3.7071 15.9671C3.51956 16.1546 3.26521 16.26 2.99999 16.26H2.98999C2.72477 16.26 2.47042 16.1546 2.28288 15.9671C2.09535 15.7796 1.98999 15.5252 1.98999 15.26V15.25ZM1.98999 10C1.98999 9.73478 2.09535 9.48043 2.28288 9.29289C2.47042 9.10536 2.72477 9 2.98999 9H2.99999C3.26521 9 3.51956 9.10536 3.7071 9.29289C3.89463 9.48043 3.99999 9.73478 3.99999 10V10.01C3.99999 10.2752 3.89463 10.5296 3.7071 10.7171C3.51956 10.9046 3.26521 11.01 2.99999 11.01H2.98999C2.72477 11.01 2.47042 10.9046 2.28288 10.7171C2.09535 10.5296 1.98999 10.2752 1.98999 10.01V10Z"
                fill="black"
              />
            </svg>
            Breakdown
            <svg
              className="-mr-1 h-5 w-5 text-gray-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
        {isOpen && ( // Render the second div only when isOpen is true
          <div
            style={{ width: "100%" }}
            className="max-h-[200px] overflow-auto"
          >
            {questions.map((question, index) => (
              <div key={index} className="flex gap-4 my-0 justify-end">
                <button
                  key={index}
                  type="button"
                  onClick={() => handleScrollToTarget(question.id)}
                  className="inline-flex w-[150px] justify-center gap-x-1.5 border-transparent bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-inset ring-gray-300 hover:bg-gray-50"
                  style={{ marginLeft: "90vw" }}
                >
                  Question {index + 1}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-gray-500 text-base leading-5 my-8">
        Begin writing the questions for your assignment below.
      </p>
      <div className="mb-24 flex flex-col gap-y-20">
        {/* TODO: make this into a component */}
        {questions.map((question, index) => {
          const questionMaxPoints =
            question.scoring?.criteria?.slice(-1)[0].points;
          return (
            <section key={index} className="flex gap-x-4 mx-auto">
              <div className="sticky top-14 flex h-full flex-col gap-y-2">
                <div className="inline-flex mx-auto rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold">
                  {index + 1}
                </div>
                <div className="text-blue-700">
                  {questionMaxPoints
                    ? questionMaxPoints === 1
                      ? `${questionMaxPoints} point`
                      : `${questionMaxPoints} points`
                    : "0 points"}
                </div>
              </div>
              <div id={`textbox-${question.id}`}>
                <TextBox questionId={question.id} />
              </div>
              {/* Display the maxPoints value received from the child component */}

              {/* Delete question button */}
              <button
                disabled={questions.length <= 1}
                className="sticky top-14 inline-flex rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
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
          );
        })}

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
