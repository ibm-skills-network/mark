import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import useCountdown from "@/hooks/use-countdown";
import { cn } from "@/lib/strings";
import { getUser, submitAssignment } from "@/lib/talkToBackend";
import { editedQuestionsOnly } from "@/lib/utils";
import {
  useAssignmentDetails,
  useGitHubStore,
  useLearnerStore,
} from "@/stores/learner";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { toast } from "sonner";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Timer(props: Props) {
  const router = useRouter();
  const [oneMinuteAlertShown, setOneMinuteAlertShown] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false); // New state to prevent re-submission
  const [role, setRole] = useState<"author" | "learner">("learner");
  const [
    activeAttemptId,
    questions,
    setQuestion,
    expiresAt,
    setTotalPointsEarned,
    setTotalPointsPossible,
    setShowSubmissionFeedback,
  ] = useLearnerStore((state) => [
    state.activeAttemptId,
    state.questions,
    state.setQuestion,
    state.expiresAt,
    state.setTotalPointsEarned,
    state.setTotalPointsPossible,
    state.setShowSubmissionFeedback,
  ]);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const authorQuestions = getStoredData<QuestionStore[]>("questions", []);
  const authorAssignmentDetails = getStoredData<ReplaceAssignmentRequest>(
    "assignmentConfig",
    {
      introduction: "",
      graded: false,
      passingGrade: 0,
      published: false,
      questionOrder: [],
      updatedAt: 0,
      questions: [],
    },
  );
  const clearGithubStore = useGitHubStore((state) => state.clearGithubStore);
  const assignmentId = assignmentDetails?.id;
  const { countdown, timerExpired, resetCountdown } = useCountdown(expiresAt);
  const seconds = Math.floor((countdown / 1000) % 60);
  const minutes = Math.floor((countdown / (1000 * 60)) % 60);
  const hours = Math.floor((countdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };
  useEffect(() => {
    // get user role
    const getUserRole = async () => {
      const user = await getUser();
      if (user) {
        setRole(user.role);
      }
    };
    void getUserRole();
  }, [assignmentId]);
  async function handleSubmitAssignment() {
    const responsesForQuestions: QuestionAttemptRequestWithId[] = questions.map(
      (q) => ({
        id: q.id,
        learnerTextResponse: q.learnerTextResponse || "",
        learnerUrlResponse: q.learnerUrlResponse || "",
        learnerChoices: q.learnerChoices || [],
        learnerAnswerChoice: q.learnerAnswerChoice ?? null,
        learnerFileResponse: q.learnerFileResponse || [],
      }),
    );

    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
      "en",
      role === "author" ? authorQuestions : undefined,
      role === "author" ? authorAssignmentDetails : undefined,
    );

    if (!res || !res.success) {
      toast.error("Failed to submit assignment.");
      return;
    }
    const { grade, feedbacksForQuestions } = res;
    setTotalPointsEarned(res.totalPointsEarned);
    setTotalPointsPossible(res.totalPossiblePoints);
    setGrade(grade * 100);
    setShowSubmissionFeedback(res.showSubmissionFeedback);
    for (const feedback of feedbacksForQuestions || []) {
      setQuestion({
        id: feedback.questionId,
        questionResponses: [
          {
            id: feedback.id,
            learnerAnswerChoice: responsesForQuestions.find(
              (q) => q.id === feedback.questionId,
            )?.learnerAnswerChoice,
            points: feedback.totalPoints,
            feedback: feedback.feedback,
            learnerResponse: feedback.question,
            questionId: feedback.questionId,
            assignmentAttemptId: activeAttemptId,
          },
        ],
      });
    }
    clearGithubStore();
    router.push(`/learner/${assignmentId}/successPage/${res.id}`);
  }

  useEffect(() => {
    if (expiresAt && countdown <= 60000 && !oneMinuteAlertShown) {
      toast.warning("You have 1 minute remaining to submit your assignment.", {
        description:
          "If you don't submit your assignment in time, it will be automatically submitted.",
      });
      setOneMinuteAlertShown(true);
    }
  }, [expiresAt, countdown, oneMinuteAlertShown]);

  // Reset countdown when activeAttemptId changes
  useEffect(() => {
    resetCountdown(expiresAt);
  }, [activeAttemptId, expiresAt, resetCountdown]);

  // If assignment runs out of time, automatically submit it
  useEffect(() => {
    if (timerExpired && !isSubmitted) {
      toast.message("Time's up! Submitting your assignment...");
      void handleSubmitAssignment();
    }
  }, [timerExpired, isSubmitted]); // Trigger only when timerExpired is true and submission hasn't been made

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
    </div>
  );
}

export default Timer;
