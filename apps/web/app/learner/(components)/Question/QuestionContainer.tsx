import Spinner from "@/components/svgs/Spinner";
import { submitQuestion } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import {
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
} from "@heroicons/react/24/outline";
import { ComponentPropsWithoutRef, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
import Button from "../Button";
import RenderQuestion from "./RenderQuestion";

interface Props extends ComponentPropsWithoutRef<"section"> {
  // question: QuestionStore;
  questionNumber: number;
  // updateStatus?: (status: QuestionStatus) => void;
  questionId: number;
}

function Component(props: Props) {
  const { className, questionId, questionNumber } = props;

  const [activeAttemptId, questions, setQuestion, setActiveQuestionNumber] =
    useLearnerStore((state) => [
      state.activeAttemptId,
      state.questions,
      state.setQuestion,
      state.setActiveQuestionNumber,
    ]);
  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  const question = useMemo(() => {
    return questions.find((q) => q.id === props.questionId);
  }, [questions, questionId]);
  const {
    id,
    type,
    totalPoints,
    numRetries,
    questionResponses,
    question: questionText,
  } = question;

  const mostRecentFeedback = useMemo(() => {
    return question.questionResponses.at(-1);
  }, [question]);

  const attemptsRemaining = numRetries
    ? numRetries - questionResponses.length
    : -1;

  const [submitted, setSubmitted] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  async function handleSubmit() {
    setSubmitting(true);
    // updateStatus("edited");
    // const question = questions[questionNumber - 1];
    // todo: show a loading indicator
    const feedback = await submitQuestion(assignmentId, activeAttemptId, id, {
      learnerTextResponse: question.learnerTextResponse || null,
      learnerUrlResponse: question.learnerUrlResponse || null,
      learnerChoices: question.learnerChoices || null,
      learnerAnswerChoice: question.learnerAnswerChoice || null,
      learnerFileResponse: question.learnerFileResponse || null,
    });
    setSubmitting(false);
    if (!feedback) {
      toast.error("Could not submit question, Mark will be back soon!");
      return;
    }

    // update question in zustand store with the feedback of the new submission
    // this is also automatically added to the backend so the learner can see
    // their previous submissions next time they log in
    setQuestion({
      ...question,
      questionResponses: [
        ...question.questionResponses,
        {
          id: feedback.id,
          //TODO: make sure this is the right var
          points: feedback.totalPoints,
          feedback: feedback.feedback,
          learnerResponse: question.learnerTextResponse,
          questionId: question.id,
          assignmentAttemptId: activeAttemptId,
        },
      ],
    });
  }

  return (
    <section className={twMerge("flex flex-col gap-y-5 relative", className)}>
      <div className="flex absolute -top-8 justify-between w-full">
        <div className="flex gap-x-1">
          <p className="text-gray-600 text-xl font-medium leading-tight">
            Question {questionNumber}:
          </p>
          <p className="text-base font-medium leading-tight my-auto">
            {mostRecentFeedback ? (
              <span className="text-green-600">
                Scored{" "}
                <span className="font-bold">
                  {Number.isInteger(mostRecentFeedback.points)
                    ? mostRecentFeedback.points
                    : mostRecentFeedback.points.toFixed(1)}{" "}
                </span>
                out of {totalPoints} points
              </span>
            ) : (
              <span className="text-blue-700">{totalPoints} points</span>
            )}
          </p>
        </div>
        {/* attempts remaining */}
        <div className="text-gray-500 text-base font-medium leading-tight">
          {attemptsRemaining > 1 || attemptsRemaining === 0 ? (
            <span>{attemptsRemaining} attempts remaining</span>
          ) : attemptsRemaining === 1 ? (
            <span>1 attempt remaining</span>
          ) : (
            // attempts remaining is -1 if there are unlimited attempts
            <span>Unlimited attempts</span>
          )}
        </div>
      </div>
      <div className="bg-white p-8 rounded-lg border border-gray-300">
        <ReactMarkdown className="mb-4 text-gray-700">
          {questionText}
        </ReactMarkdown>
        <RenderQuestion questionType={type} />
      </div>
      {/* Feedback section */}
      {mostRecentFeedback && (
        <div className="bg-green-100 border border-green-500 p-5 rounded-lg shadow-sm">
          <p className="text-green-700 text-center font-medium">
            <span className="font-bold">
              {mostRecentFeedback.points}/{totalPoints}
            </span>{" "}
            {mostRecentFeedback.feedback[0].feedback}
          </p>
        </div>
      )}
      <div className="flex justify-between">
        <button
          onClick={() => setActiveQuestionNumber(questionNumber - 1)}
          disabled={questionNumber === 1}
          className="disabled:invisible text-gray-600 font-medium flex items-center group gap-x-1.5"
        >
          <ArrowLongLeftIcon
            strokeWidth={2}
            className="w-5 h-5 transition-transform group-hover:-translate-x-0.5"
          />
          Question {questionNumber - 1}
        </button>

        <Button
          disabled={attemptsRemaining === 0 || submitting}
          className="disabled:opacity-50 transition-all"
          onClick={handleSubmit}
        >
          {submitting ? <Spinner className="w-7 h-7" /> : "Submit Response"}
        </Button>
        <button
          onClick={() => setActiveQuestionNumber(questionNumber + 1)}
          disabled={questionNumber === questions.length}
          className="disabled:invisible text-gray-600 font-medium flex items-center group gap-x-1.5"
        >
          Question {questionNumber + 1}
          <ArrowLongRightIcon
            strokeWidth={2}
            className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </section>
  );
}

export default Component;
