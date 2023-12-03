// This is the component that we use to add/delete questions for author, it contains two buttons
// which are "add new textbox" and "delete"
"use client";

import PageWithStickySides from "@/app/components/PageWithStickySides";
import { initialCriteria } from "@/config/constants";
import { CreateQuestionRequest, QuestionAuthorStore } from "@/config/types";
import useBeforeUnload from "@/hooks/use-before-unload";
import {
  createQuestion,
  deleteQuestion,
  getAssignment,
} from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/24/solid";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
import QuestionWrapper from "./QuestionWrapper";

interface Props {
  assignmentId: number;
  defaultQuestionRetries: number;
}
function AuthorQuestionsPage(props: Props) {
  const { assignmentId, defaultQuestionRetries } = props;
  const router = useRouter();
  useBeforeUnload(
    "Are you sure you want to leave this page? You will lose any unsaved changes."
  );
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
      const fetchAssignment = async () => {
        const assignment = await getAssignment(assignmentId);
        console.log("assignment", assignment);
        if (assignment) {
          setActiveAssignmentId(assignmentId);
          // update the state of the introduction page with the assignment details from the backend
          setAssignmentTitle(assignment.name || "Untitled Assignment");
          const questions: QuestionAuthorStore[] = assignment.questions?.map(
            (question) => {
              const criteriaWithId = question.scoring?.criteria?.map(
                (criteria, index) => {
                  return {
                    ...criteria,
                    id: index + 1,
                  };
                }
              );
              return {
                ...question,
                // choices:
                alreadyInBackend: true,
                scoring: {
                  // TODO: hardcoded for now but we need to find a way to add the type
                  type: "CRITERIA_BASED",
                  // adding the id to the criteria so that we can use it as the key in the loop
                  criteria: criteriaWithId || initialCriteria,
                },
              };
            }
          );
          if (questions?.length > 0) {
            // if there are questions, then add them to the store
            // if the assignment has questionOrder, then it's already sorted from the backend, otherwise sort it by id
            const sortedQuestions =
              assignment?.questionOrder.length > 0
                ? questions
                : questions.sort((a, b) => a.id - b.id);
            setQuestions(sortedQuestions);
          } else {
            console.log("no questions");
          }
        } else {
          toast.error("Failed to get assignment details");
          router.push("/");
        }
      };
      void fetchAssignment();
    }
    //  if there are no questions, add one question to the store
    console.log("questions", questions);
  }, []);
  async function handleAddTextBox() {
    const question: CreateQuestionRequest = {
      question: " ",
      totalPoints: 1,
      // if default has not been given, then set it to 1
      numRetries: defaultQuestionRetries ?? 1,
      // TODO: have different buttons so that users can easily add other type of questions
      type: "TEXT",
      scoring: {
        type: "CRITERIA_BASED",
        criteria: initialCriteria,
      },
    };
    const questionId = await createQuestion(assignmentId, question);
    addQuestion({
      ...question,
      question: "",
      id: questionId,
      alreadyInBackend: true,
      assignmentId: assignmentId,
    });
    // scroll to the bottom of the page
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth",
    });
  }
  // setScrollTargets((prevTargets) => {
  //   const newTargets: number[] = [
  //     ...(prevTargets as number[]),
  //     questions.length + 1,
  //   ];
  //   return newTargets;
  // });

  async function handleDeleteTextBox(
    alreadyInBackend: boolean,
    // questionNumber?: number,
    questionId: number
  ) {
    // call the backend to delete the question if it came from the backend
    if (alreadyInBackend) {
      const success = await deleteQuestion(assignmentId, questionId);
      if (success) {
        removeQuestion(questionId);
        toast.success("Question deleted!");
        return;
      }
    } else {
      removeQuestion(questionId);
      return;
    }
    toast.error("Failed to delete question");
  }

  // TODO: duplicate feat

  return (
    <>
      {questions.length === 0 && (
        <p className="text-center text-gray-500 text-base leading-5 my-12">
          Begin writing the questions for your assignment below.
        </p>
      )}
      <div
        className={twMerge(
          "flex flex-col gap-y-20",
          questions.length === 0 ? "mb-24" : "my-24"
        )}
      >
        {/* TODO: make this into a component */}
        {questions.map((question, index) => {
          const questionNumber = index + 1;
          let questionMaxPoints: number;
          if (
            (question.type === "TEXT" || question.type === "URL") &&
            question.scoring?.type === "CRITERIA_BASED" &&
            question.scoring?.criteria.length > 0
          ) {
            questionMaxPoints = question.scoring.criteria.at(-1).points;
          } else {
            questionMaxPoints = question.totalPoints;
          }
          console.log("question", question);

          return (
            <PageWithStickySides
              key={questionNumber}
              leftStickySide={
                <>
                  <div className="inline-flex mx-auto rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold">
                    {questionNumber}
                  </div>
                  {/* Display the maxPoints value received from the child component */}
                  <div className="text-blue-700 w-16 whitespace-nowrap">
                    {questionMaxPoints
                      ? questionMaxPoints === 1
                        ? `${questionMaxPoints} point`
                        : `${questionMaxPoints} points`
                      : "0 points"}
                  </div>
                </>
              }
              mainContent={
                <QuestionWrapper
                  id={`question-${question.id}`}
                  questionId={question.id}
                />
              }
              rightStickySide={
                <button
                  // disabled={questions.length <= 1}
                  className="inline-flex rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() =>
                    handleDeleteTextBox(question.alreadyInBackend, question.id)
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
              }
            />
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

export default AuthorQuestionsPage;
