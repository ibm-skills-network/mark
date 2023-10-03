import type { Question, QuestionStatus, QuestionStore } from "@/config/types";
import { submitQuestion } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { ComponentPropsWithoutRef, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";
import Button from "../Button";
import RenderQuestion from "./RenderQuestion";

interface Props extends ComponentPropsWithoutRef<"section"> {
  // question: QuestionStore;
  // questionNumber: number;
  // updateStatus?: (status: QuestionStatus) => void;
  questionId: number;
}

function Component(props: Props) {
  const { className, questionId } = props;
  // const { type, totalPoints } = question;

  const [activeAttemptId, questions, setQuestion] = useLearnerStore((state) => [
    state.activeAttemptId,
    state.questions,
    state.setQuestion,
  ]);
  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  const question = useMemo(() => {
    return questions.find((q) => q.id === props.questionId);
  }, [questions, questionId]);

  const attemptsRemaining =
    question.numRetries - question.questionResponses.length;

  const [submitted, setSubmitted] = useState<boolean>(false);
  async function handleSubmit() {
    // setSubmitted(true);
    // updateStatus("edited");
    // const question = questions[questionNumber - 1];
    console.log("question", question);
    // todo: show a loading indicator
    const feedback = await submitQuestion(
      assignmentId,
      activeAttemptId,
      question.id,
      {
        learnerTextResponse: question.learnerTextResponse || null,
        learnerUrlResponse: question.learnerUrlResponse || null,
        learnerChoices: question.learnerChoices || null,
        learnerAnswerChoice: question.learnerAnswerChoice || null,
        learnerFileResponse: question.learnerFileResponse || null,
      }
    );
    console.log("feedback", feedback);
    // TODO: update the question status, and the total points, and the feedback

    // update question in zustand store with the feedback of the new submission
    // this is also automatically added to the backend so the learner can see
    // their previous submissions next time they log in
    setQuestion({
      ...question,
      questionResponses: [
        ...question.questionResponses,
        {
          id: feedback.id,
          points: feedback.feedback[0].points,
          feedback: feedback.feedback,
          learnerResponse: question.learnerTextResponse,
          questionId: question.id,
          assignmentAttemptId: activeAttemptId,
        },
      ],
    });
  }

  return (
    <section className={twMerge("", className)}>
      <div className="flex justify-between">
        <div className="space-x-1">
          <span className="text-gray-600 text-xl font-medium leading-tight">
            Question {questionId}
          </span>
          <span className="text-blue-700 text-base font-medium leading-tight">
            {question.totalPoints.toFixed(2)} Points
          </span>
        </div>
        {/* attempts remaining */}
        <div className="text-gray-500 text-base font-medium leading-tight">
          {attemptsRemaining === 1
            ? "1 attempt remaining"
            : `${attemptsRemaining || "No"} attempts remaining`}
        </div>
      </div>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <p className="mb-4 text-gray-700">{question.question}</p>
        <RenderQuestion questionType={question.type} />
      </div>
      <div className="flex justify-center mt-4">
        <Button
          disabled={attemptsRemaining === 0}
          className="disabled:opacity-50"
          onClick={handleSubmit}
        >
          Submit Question
        </Button>
      </div>
    </section>
  );
}

export default Component;
