import { readAuthorPreviewPayload } from "@/app/learner/utils/authorPreview";
import type {
  QuestionAttemptRequestWithId,
  ReplaceAssignmentRequest,
} from "@/config/types";
import { useAssignmentId } from "@/hooks/use-assignment-id";
import useCountdown from "@/hooks/use-countdown";
import { isGradingStreamLostError } from "@/lib/learner";
import { cn } from "@/lib/strings";
import { getUser, submitAssignment } from "@/lib/talkToBackend";
import {
  useAssignmentDetails,
  useGitHubStore,
  useLearnerStore,
} from "@/stores/learner";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { toast } from "sonner";

type Props = ComponentPropsWithoutRef<"div">;

function Timer(props: Props) {
  const router = useRouter();
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
  );
  const [oneMinuteAlertShown, setOneMinuteAlertShown] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  // The auto-submit effect deliberately omits role from its deps; reading the
  // role through a ref keeps the timed submit from capturing the stale "learner"
  // default when getUser() resolves to "author" after the effect has run. (Only
  // submission uses the role — the render does not — so a ref, not state.)
  const roleRef = useRef<"author" | "learner">("learner");
  const [
    activeAttemptId,
    questions,
    setQuestion,
    expiresAt,
    setTotalPointsEarned,
    setTotalPointsPossible,
    setShowSubmissionFeedback,
    setLearnerStore,
  ] = useLearnerStore((state) => [
    state.activeAttemptId,
    state.questions,
    state.setQuestion,
    state.expiresAt,
    state.setTotalPointsEarned,
    state.setTotalPointsPossible,
    state.setShowSubmissionFeedback,
    state.setLearnerStore,
  ]);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const clearGithubStore = useGitHubStore((state) => state.clearGithubStore);
  // The URL is authoritative; assignmentDetails is only populated on the
  // overview route and is null on a deep link / hard refresh, which would
  // otherwise gate off auto-submit and silently drop a timed submission.
  const { assignmentId, assignmentIdParam } = useAssignmentId();
  const authorPreviewPayload = assignmentId
    ? readAuthorPreviewPayload(assignmentId)
    : null;
  const authorQuestions = authorPreviewPayload?.questions ?? questions;
  const authorAssignmentDetails: ReplaceAssignmentRequest | undefined =
    authorPreviewPayload?.assignmentDetails
      ? (authorPreviewPayload.assignmentDetails as ReplaceAssignmentRequest)
      : assignmentDetails
        ? (assignmentDetails as ReplaceAssignmentRequest)
        : undefined;
  const { countdown, timerExpired, resetCountdown } = useCountdown(expiresAt);
  const hasCountdown = typeof countdown === "number";
  const safeCountdown = hasCountdown ? countdown : 0;

  const seconds = Math.floor((safeCountdown / 1000) % 60);
  const minutes = Math.floor((safeCountdown / (1000 * 60)) % 60);
  const hours = Math.floor((safeCountdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };
  useEffect(() => {
    const getUserRole = async () => {
      const user = await getUser();
      if (user) {
        roleRef.current = user.role;
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
        learnerChoices:
          roleRef.current === "author"
            ? q.choices
                ?.map((choice, index) =>
                  q.learnerChoices?.find((c) => String(c) === String(index))
                    ? choice.choice
                    : undefined,
                )
                .filter((choice) => choice !== undefined) || []
            : q.translations?.[userPreferedLanguage]?.translatedChoices
              ? q.translations?.[userPreferedLanguage]?.translatedChoices
                  ?.map((choice, index) =>
                    q.learnerChoices?.find((c) => String(c) === String(index))
                      ? choice.choice
                      : undefined,
                  )
                  .filter((choice) => choice !== undefined) || []
              : q.choices
                  ?.map((choice, index) =>
                    q.learnerChoices?.find((c) => String(c) === String(index))
                      ? choice.choice
                      : undefined,
                  )
                  .filter((choice) => choice !== undefined) || [],
        learnerAnswerChoice: q.learnerAnswerChoice ?? null,
        learnerFileResponse: (q.learnerFileResponse || []).map((file) => {
          const extension = file.filename.split(".").pop()?.toLowerCase() || "";
          if (["jpg", "jpeg", "png", "gif", "svg"].includes(extension)) {
            return {
              ...file,
            };
          }
          return file;
        }),
        learnerPresentationResponse: q.presentationResponse ?? null,
        selectedLanguage: q.selectedLanguage,
      }),
    );

    if (!assignmentId) {
      console.warn(
        "[learner] auto-submit blocked: assignmentId missing from route",
        {
          assignmentIdParam,
          hasActiveAttemptId: activeAttemptId !== null,
        },
      );
      toast.error(
        "Something went wrong. Please reload the page or exit and relaunch the assignment.",
      );
      return;
    }

    let res: Awaited<ReturnType<typeof submitAssignment>>;
    try {
      res = await submitAssignment(
        assignmentId,
        activeAttemptId,
        responsesForQuestions,
        userPreferedLanguage,
        roleRef.current === "author" ? authorQuestions : undefined,
        roleRef.current === "author" ? authorAssignmentDetails : undefined,
      );
    } catch (error) {
      // Auto-submit runs from a fire-and-forget setTimeout; without this catch a
      // 401/network rejection is an unhandled promise and the learner is told
      // their work "will be graded automatically" while it was silently lost.
      if (isGradingStreamLostError(error)) {
        // The submission itself went through — only the grading status
        // stream gave up watching it. Telling the learner to resubmit here
        // would be actively wrong (their answers are already in) and risks
        // a duplicate attempt, so this reuses the stream's own honest
        // message instead of the generic "try again" copy below.
        console.error("[learner] auto-submit lost the grading stream", {
          assignmentId,
          activeAttemptId,
          reason: error.reason,
        });
        toast.error(error.message);
        return;
      }
      console.error("[learner] auto-submit failed", {
        assignmentId,
        activeAttemptId,
        error,
      });
      toast.error(
        "We couldn't submit your assignment automatically. Check your connection and use the Submit button to try again.",
      );
      return;
    }
    if (!res) {
      toast.error("Failed to submit assignment.");
      return;
    }
    const { grade, feedbacksForQuestions } = res;
    setTotalPointsEarned(res.totalPointsEarned);
    setTotalPointsPossible(res.totalPossiblePoints);
    if (grade !== undefined) {
      setGrade(grade * 100);
    } else {
      // No grade on this submission (score hidden): clear any grade left
      // from a previous attempt so the success page doesn't show it.
      setGrade(null);
    }
    setShowSubmissionFeedback(res.showSubmissionFeedback);
    for (const question of questions) {
      const updatedQuestion = {
        ...question,
        learnerChoices: responsesForQuestions.find((q) => q.id === question.id)
          ?.learnerChoices,
      };
      setQuestion(updatedQuestion);
    }

    for (const feedback of feedbacksForQuestions || []) {
      setQuestion({
        id: feedback.questionId,
        questionResponses: [
          {
            id: feedback.id,
            learnerAnswerChoice: responsesForQuestions.find(
              (q) => q.id === feedback.questionId,
            )?.learnerAnswerChoice,
            points: feedback.totalPoints ?? 0,
            feedback: feedback.feedback || [],
            learnerResponse: feedback.question,
            questionId: feedback.questionId,
            assignmentAttemptId: activeAttemptId,
          },
        ],
      });
    }
    clearGithubStore();
    setLearnerStore({
      activeAttemptId: null,
      expiresAt: undefined,
    });
    useLearnerStore.getState().setActiveQuestionNumber(null);
    setTimeout(() => {
      useLearnerStore.getState().setUserPreferedLanguage(null);
    }, 1000);
    router.push(`/learner/${assignmentId}/successPage/${res.id}`);
  }

  useEffect(() => {
    if (
      expiresAt &&
      hasCountdown &&
      countdown <= 60000 &&
      !oneMinuteAlertShown
    ) {
      toast.warning("You have 1 minute remaining to submit your assignment.", {
        description:
          "If you don't submit your assignment in time, it will be automatically submitted.",
      });
      setOneMinuteAlertShown(true);
    }
  }, [expiresAt, countdown, oneMinuteAlertShown]);

  useEffect(() => {
    resetCountdown(expiresAt);
  }, [activeAttemptId, expiresAt, resetCountdown]);

  useEffect(() => {
    if (activeAttemptId) {
      setOneMinuteAlertShown(false);
      setIsSubmitted(false);
    }
  }, [activeAttemptId]);

  useEffect(() => {
    if (timerExpired && !isSubmitted && assignmentId && activeAttemptId) {
      setIsSubmitted(true);
      toast.message(
        "Time's up! Your responses have been saved and will be graded automatically.",
      );

      setTimeout(() => {
        void handleSubmitAssignment();
      }, 2000);
    }
  }, [timerExpired, isSubmitted, assignmentId, activeAttemptId]);

  return (
    <div className="flex items-center space-x-2" {...props}>
      <div className="text-gray-600 dark:text-gray-300 text-base font-medium leading-tight">
        Time Remaining:
      </div>
      {hasCountdown ? (
        <div
          className={cn(
            "text-base font-bold leading-tight",
            hours === 0 && minutes < 5 ? "text-red-500" : "text-purple-600",
          )}
        >
          {twoDigit(hours)}:{twoDigit(minutes)}:{twoDigit(seconds)}
        </div>
      ) : (
        <div className="text-base font-bold leading-tight text-gray-400">
          --:--:--
        </div>
      )}
    </div>
  );
}

export default Timer;
