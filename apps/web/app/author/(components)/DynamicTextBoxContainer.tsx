// This is the component that we use to add/delete questions for author, it contains two buttons
// which are "add new textbox" and "delete"
"use client";

import { initialCriteria } from "@/config/constants";
import { deleteQuestion, getAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/solid";
import { useEffect } from "react";
import { toast } from "sonner";
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

  useEffect(() => {
    // check if we have the assignment details in the store
    // if not, call the backend to get the assignment details
    console.log("assignmentId", assignmentId);
    if (assignmentId !== activeAssignmentId) {
      (async () => {
        const assignment = await getAssignment(assignmentId);
        console.log("assignment", assignment);
        if (assignment) {
          setActiveAssignmentId(assignmentId);
          // update the state of the introduction page with the assignment details from the backend
          setAssignmentTitle(assignment.name || "Untitled Assignment");
          const questions = assignment.questions?.map((question) => {
            return {
              ...question,
              // turn the choices into a map
              choices: new Map(
                // turn the choices object into an array of key value arrays (entries) and then turn that into a map
                Object.entries(question.choices || {}).map(
                  ([choice, isCorrect]) => [choice, isCorrect]
                )
              ),
              alreadyInBackend: true,
              scoring: {
                // TODO: hardcoded for now but we need to find a way to add the type
                type: "CRITERIA_BASED",
                ...question.scoring,
              },
            };
          });
          if (questions?.length > 0) {
            // if there are questions, sort them by id and set them in the store
            const sortedQuestions = questions?.sort((a, b) => a.id - b.id);
            setQuestions(sortedQuestions);
          } else {
            console.log("no questions");
          }
        } else {
          //
          console.log("assignment not found");
        }
      })().catch((err) => {
        console.log("err", err);
      });
    }
    //  if there are no questions, add one question to the store
    console.log("questions", questions);
    if (questions.length === 0) {
      console.log("adding question", questions);
      addQuestion({
        id: 0,
        assignmentId: activeAssignmentId,
        question: "",
        totalPoints: 1,
        numRetries: defaultQuestionRetries || 1,
        type: "TEXT",
        alreadyInBackend: false,
        scoring: {
          type: "CRITERIA_BASED",
          criteria: initialCriteria,
        },
      });
    }
  }, []);
  const handleAddTextBox = () => {
    addQuestion({
      id: (questions.slice(-1)[0]?.id || 0) + 1,
      assignmentId: activeAssignmentId,
      question: "",
      totalPoints: 1,
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

  async function handleDeleteTextBox(
    questionId: number,
    alreadyInBackend: boolean
  ) {
    // call the backend to delete the question if it came from the backend
    let success = true; // by default we assume that the question is not from the backend
    if (alreadyInBackend) {
      success = await deleteQuestion(assignmentId, questionId);
    }
    if (success) {
      removeQuestion(questionId);
      toast.success("Question deleted!");
    } else {
      toast.error("Failed to delete question");
    }
  }
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
      <div className="my-24 flex flex-col gap-y-20">
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
              <TextBox id={`textbox-${question.id}`} questionId={question.id} />

              {/* Display the maxPoints value received from the child component */}

              {/* Delete question button */}
              <button
                disabled={questions.length <= 1}
                className="sticky top-14 inline-flex rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() =>
                  handleDeleteTextBox(question.id, question.alreadyInBackend)
                }
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
