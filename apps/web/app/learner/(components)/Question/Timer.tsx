import type { QuestionAttemptRequestWithId } from "@/config/types";
import useCountdown from "@/hooks/use-countdown";
import { cn } from "@/lib/strings";
import { submitAssignment } from "@/lib/talkToBackend";
import { editedQuestionsOnly } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { toast } from "sonner";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Timer(props: Props) {
  const router = useRouter();

  const [oneMinuteAlertShown, setOneMinuteAlertShown] = useState(false);

  // const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const [activeAttemptId, questions, setQuestion, expiresAt] = useLearnerStore(
    (state) => [
      state.activeAttemptId,
      state.questions,
      state.setQuestion,
      state.expiresAt,
    ],
  );
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const assignmentId = assignmentDetails?.id;
  const { countdown, timerExpired, resetCountdown } = useCountdown(expiresAt);
  const seconds = Math.floor((countdown / 1000) % 60);
  const minutes = Math.floor((countdown / (1000 * 60)) % 60);
  const hours = Math.floor((countdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };

  async function handleSubmitAssignment() {
    const responsesForOnlyEditedQuestions = editedQuestionsOnly(questions);
    const responsesForQuestions: QuestionAttemptRequestWithId[] =
      responsesForOnlyEditedQuestions.map((q) => ({
        id: q.id,
        learnerTextResponse: q.learnerTextResponse || undefined,
        learnerUrlResponse: q.learnerUrlResponse || undefined,
        learnerChoices: q.learnerChoices || undefined,
        learnerAnswerChoice: q.learnerAnswerChoice || undefined,
        learnerFileResponse: q.learnerFileResponse || undefined,
      }));
    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
    );
    if (!res || !res.success) {
      toast.error("Failed to submit assignment.");
      return;
    }
    const { grade, feedbacksForQuestions } = res;
    if (typeof grade === "number") {
      setGrade(grade * 100);
    }

    for (const feedback of feedbacksForQuestions || []) {
      setQuestion({
        id: feedback.questionId,
        questionResponses: [
          {
            id: feedback.id,
            points: feedback.totalPoints,
            feedback: feedback.feedback,
            learnerResponse: feedback.question,
            questionId: feedback.questionId,
            assignmentAttemptId: activeAttemptId,
          },
        ],
      });
    }
    // ${grade >= passingGrade ? "You passed!" : "You failed."}`);
    const currentTime = Date.now();
    console.log("currentTime", currentTime);
    router.push(`/learner/${assignmentId}?submissionTime=${currentTime}`);
  }

  useEffect(() => {
    if (expiresAt && countdown <= 60000 && !oneMinuteAlertShown) {
      toast.warning("You have 1 minute remaining to submit your assignment.", {
        description:
          "If you don't submit your assignment in time, it will be automatically submitted.",
      });
      setOneMinuteAlertShown(true);
    }
  }, [expiresAt, countdown]);

  // Reset countdown when activeAttemptId changes
  useEffect(() => {
    resetCountdown(expiresAt);
  }, [activeAttemptId, expiresAt, resetCountdown]);

  // if assignment runs out of time, automatically submit
  if (timerExpired) {
    toast.message("Time's up! Submitting your assignment...");
    void handleSubmitAssignment();
    return null;
  }

  // const countdown = usePersistentCountdown({
  //   keyString: `assignment-${assignmentId}-attempt-${activeAttemptId}-countdown`,
  //   initialCountdown: timeInSecs,
  // });

  return (
    <div className="flex items-center space-x-2" {...props}>
      <div className="text-gray-600 text-base font-medium leading-tight">
        Time Remaining:
      </div>
      <div
        className={cn(
          "text-base font-bold leading-tight",
          hours === 0 && minutes < 5 ? "text-red-500" : "text-blue-600",
        )}
      >
        {twoDigit(hours)}:{twoDigit(minutes)}:{twoDigit(seconds)}
      </div>
      {/* show a modal that tells the user that they cannot submit any more questions */}
      {/* {!timerExpired && <TimerExpiredModal />} */}
    </div>
  );
}

export default Timer;
