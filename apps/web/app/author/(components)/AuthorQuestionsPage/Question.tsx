import PageWithStickySides from "@/app/components/PageWithStickySides";
import type { QuestionAuthorStore } from "@/config/types";
import { deleteQuestion } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import { toast } from "sonner";
import QuestionWrapper from "../QuestionWrapper";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionAuthorStore;
  assignmentId: number;
  index: number;
}

const Component: FC<Props> = (props) => {
  const { question, index, assignmentId } = props;
  const questionNumber = index + 1;
  const [questionMaxPoints, setQuestionMaxPoints] = useState<number>(1);

  const [removeQuestion] = useAuthorStore((state) => [state.removeQuestion]);
  useEffect(() => {
    if (
      (question.type === "TEXT" || question.type === "URL") &&
      question.scoring?.type === "CRITERIA_BASED" &&
      question.scoring?.criteria &&
      question.scoring.criteria.length > 0
    ) {
      setQuestionMaxPoints(question.scoring.criteria.at(-1).points);
    } else {
      setQuestionMaxPoints(question.totalPoints);
    }
  }, [question]);
  async function handleDeleteTextBox(
    alreadyInBackend: boolean,
    // questionNumber?: number,
    questionId: number,
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
};

export default Component;
