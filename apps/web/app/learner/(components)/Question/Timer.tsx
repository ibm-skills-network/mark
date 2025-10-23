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

type Props = ComponentPropsWithoutRef<"div">;

function Timer(props: Props) {
  const router = useRouter();
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
  );
  const [oneMinuteAlertShown, setOneMinuteAlertShown] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [role, setRole] = useState<"author" | "learner">("learner");
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
        learnerChoices:
          role === "author"
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
        selectedLanguage: q.selectedLanguage, // Include question-specific language selection
      }),
    );

    if (!assignmentId) {
      toast.error("Assignment ID is missing.");
      return;
    }

    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
      userPreferedLanguage,
      role === "author" ? authorQuestions : undefined,
      role === "author" ? authorAssignmentDetails : undefined,
    );
    if (!res) {
      toast.error("Failed to submit assignment.");
      return;
    }
    const { grade, feedbacksForQuestions } = res;
    setTotalPointsEarned(res.totalPointsEarned);
    setTotalPointsPossible(res.totalPossiblePoints);
    if (grade !== undefined) {
      setGrade(grade * 100);
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
    if (timerExpired && !isSubmitted) {
      toast.message("Time's up! Submitting your assignment...");
      void handleSubmitAssignment();
    }
  }, [timerExpired, isSubmitted]);

  return (
    <div className="flex items-center space-x-2" {...props}>
      <div className="text-gray-600 text-base font-medium leading-tight">
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
