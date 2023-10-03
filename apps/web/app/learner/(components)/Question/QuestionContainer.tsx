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

  const mostRecentFeedback = useMemo(() => {
    return question.questionResponses.slice(-1)[0];
  }, [question]);

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
    <section className={twMerge("flex flex-col gap-y-5", className)}>
      <div className="flex absolute top-0 justify-between">
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
      <div className="bg-white p-8 rounded-lg border border-gray-300">
        <p className="mb-4 text-gray-700">{question.question}</p>
        <RenderQuestion questionType={question.type} />
      </div>
      {/* Feedback section */}
      {mostRecentFeedback && (
        <div className="bg-green-100 p-5 rounded-lg shadow-sm">
          <div className="text-gray-500 text-base font-medium leading-tight">
            Attempt {question.questionResponses.length} of {question.numRetries}
          </div>
          <p className="text-green-700 text-center font-medium">
            {mostRecentFeedback.feedback[0].feedback}
          </p>
        </div>
      )}
      <div className="flex justify-center">
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
