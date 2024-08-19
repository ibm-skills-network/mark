import MarkdownViewer from "@/components/MarkdownViewer";
import { cn } from "@/lib/strings";
import { submitQuestion } from "@/lib/talkToBackend";
import { getFeedbackColors } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import {
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
} from "@heroicons/react/24/outline";
import { ComponentPropsWithoutRef, useMemo, useState } from "react";
import { toast } from "sonner";
import RenderQuestion from "./RenderQuestion";

interface Props extends ComponentPropsWithoutRef<"section"> {
  // question: QuestionStore;
  questionNumber: number;
  // updateStatus?: (status: QuestionStatus) => void;
  questionId: number;
}

function Component(props: Props) {
  const { className, questionId, questionNumber } = props;

  const [
    activeAttemptId,
    questions,
    setQuestion,
    setActiveQuestionNumber,
    setChoices,
  ] = useLearnerStore((state) => [
    state.activeAttemptId,
    state.questions,
    state.setQuestion,
    state.setActiveQuestionNumber,
    state.setChoices,
  ]);
  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id,
  );

  const question = useMemo(() => {
    return questions.find((q) => q.id === questionId);
  }, [questions, questionId]);
  const {
    id,
    type,
    totalPoints,
    numRetries,
    questionResponses,
    question: questionText,
  } = question;

  const [submitting, setSubmitting] = useState<boolean>(false);

  async function handleSubmit() {
    setSubmitting(true);
    // updateStatus("edited");
    // const question = questions[questionNumber - 1];
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
      questionResponses: [
        ...question.questionResponses,
        {
          id: feedback.id,
          points: feedback.totalPoints,
          feedback: feedback.feedback,
          learnerResponse:
            question.learnerTextResponse ||
            question.learnerUrlResponse ||
            question.learnerChoices?.toString() ||
            question.learnerAnswerChoice?.toString() ||
            question.learnerFileResponse?.toString() ||
            null,
          questionId: question.id,
          assignmentAttemptId: activeAttemptId,
        },
      ],
    });
  }

  return (
    <section className={cn("flex flex-col gap-y-5 relative", className)}>
      <div className="flex absolute -top-8 justify-between w-full">
        <div className="flex gap-x-1">
          <p className="text-gray-600 text-xl font-medium leading-tight">
            Question {questionNumber}:
          </p>
          <p className="text-base font-medium leading-tight my-auto">
            <span className="text-blue-700">{totalPoints} points</span>
          </p>
        </div>
        {/* attempts remaining */}
      </div>
      <div className="bg-white p-8 rounded-lg border border-gray-300">
        <MarkdownViewer className="mb-4 text-gray-700">
          {questionText}
        </MarkdownViewer>
        <RenderQuestion questionType={type} />
      </div>
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
