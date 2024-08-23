"use client";

import { initialCriteria } from "@/config/constants";
import type {
  CreateQuestionRequest,
  QuestionAuthorStore,
} from "@/config/types";
import { cn } from "@/lib/strings";
import { createQuestion, getAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/24/solid";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Question from "./Question";

interface Props {
  assignmentId: number;
  defaultQuestionRetries: number;
}
function AuthorQuestionsPage(props: Props) {
  const { assignmentId, defaultQuestionRetries } = props;
  const router = useRouter();
  // const [textBoxes, setTextBoxes] = useState<number[]>([Date.now()]); // Initialize with one textbox

  // click me button for textboxes
  // const [scrollTargets, setScrollTargets] = useState([]); // Keep track of scroll targets for each textbox
  const [
    questions,
    setQuestions,
    addQuestion,
    activeAssignmentId,
    setActiveAssignmentId,
    setName,
  ] = useAuthorStore((state) => [
    state.questions,
    state.setQuestions,
    state.addQuestion,
    state.activeAssignmentId,
    state.setActiveAssignmentId,
    state.setName,
  ]);

  useEffect(() => {
    // check if we have the assignment details in the store
    // if not, call the backend to get the assignment details
    if (assignmentId !== activeAssignmentId) {
      const fetchAssignment = async () => {
        const assignment = await getAssignment(assignmentId);
        if (assignment) {
          setActiveAssignmentId(assignmentId);
          // update the state of the introduction page with the assignment details from the backend
          setName(assignment.name || "Untitled Assignment");
          const questions: QuestionAuthorStore[] = assignment.questions?.map(
            (question) => {
              const criteriaWithId = question.scoring?.criteria?.map(
                (criteria, index) => {
                  return {
                    ...criteria,
                    id: index + 1,
                  };
                },
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
            },
          );
          if (questions?.length > 0) {
            setQuestions(questions);
          }
        } else {
          toast.error("Failed to get assignment details");
          router.push("/");
        }
      };
      void fetchAssignment();
    }
    //  if there are no questions, add one question to the store
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
    if (!questionId) {
      toast.error("Failed to add question");
      return;
    }
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

  // TODO: duplicate feat

  return (
    <>
      {questions.length === 0 && (
        <p className="text-center text-gray-500 text-base leading-5 my-12">
          Begin writing the questions for your assignment below.
        </p>
      )}
      <div
        className={cn(
          "flex flex-col gap-y-20",
          questions.length === 0 ? "mb-24" : "my-24",
        )}
      >
        {/* TODO: make this into a component */}
        {questions.map((question, index) => (
          <Question
            key={question.id}
            question={question}
            assignmentId={assignmentId}
            index={index}
          />
        ))}

        <button
          type="button"
          className="mx-auto rounded-full bg-blue-700 p-2 text-white shadow-sm hover:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={handleAddTextBox}
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

export default AuthorQuestionsPage;
