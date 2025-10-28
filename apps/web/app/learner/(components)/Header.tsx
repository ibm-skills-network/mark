"use client";

import { useMarkChatStore } from "@/app/chatbot/store/useMarkChatStore";
import { getLanguageName } from "@/app/Helpers/getLanguageName";
import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import Dropdown from "@/components/Dropdown";
import Spinner from "@/components/svgs/Spinner";
import WarningAlert from "@/components/WarningAlert";
import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  ReplaceAssignmentRequest,
  SubmitAssignmentResponse,
} from "@/config/types";
import {
  getSupportedLanguages,
  getUser,
  submitAssignment,
} from "@/lib/talkToBackend";
import { editedQuestionsOnly, getSubmitButtonStatus } from "@/lib/utils";
import {
  useAssignmentDetails,
  useGitHubStore,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import Button from "../../../components/Button";
import GradingProgressModal from "./GradingProgressModal";

function LearnerHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [gradingProgress, setGradingProgress] = useState({
    isOpen: false,
    progress: 0,
    message: "Initializing...",
    status: "idle" as "idle" | "processing" | "completed" | "failed",
  });

  const [
    questions,
    setQuestion,
    setShowSubmissionFeedback,
    activeAttemptId,
    setTotalPointsEarned,
    setTotalPointsPossible,
    clearLearnerAnswers,
  ] = useLearnerStore((state) => [
    state.questions,
    state.setQuestion,
    state.setShowSubmissionFeedback,
    state.activeAttemptId,
    state.setTotalPointsEarned,
    state.setTotalPointsPossible,
    state.clearLearnerAnswers,
  ]);
  const setUserRole = useMarkChatStore((s) => s.setUserRole);
  useEffect(() => {
    setUserRole("learner");
  }, [setUserRole]);
  const clearGithubStore = useGitHubStore((state) => state.clearGithubStore);
  const authorQuestions = getStoredData<QuestionStore[]>("questions", []);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const [userPreferedLanguage, setUserPreferedLanguage] = useLearnerStore(
    (state) => [state.userPreferedLanguage, state.setUserPreferedLanguage],
  );
  const buttonStatus = getSubmitButtonStatus(questions, submitting);

  const authorAssignmentDetails = getStoredData<ReplaceAssignmentRequest>(
    "assignmentConfig",
    {
      introduction: "",
      graded: false,
      passingGrade: 0,
      published: false,
      questionOrder: [],
      updatedAt: 0,
    },
  );
  const [returnUrl, setReturnUrl] = useState<string>("");
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
  const isInQuestionPage = pathname.includes("questions");
  const isAttemptPage = pathname.includes("attempts");
  const isSuccessPage = pathname.includes("successPage");
  const [toggleWarning, setToggleWarning] = useState<boolean>(false);
  const [toggleEmptyWarning, setToggleEmptyWarning] = useState<boolean>(false);
  const [role, setRole] = useState<string | undefined>(undefined);
  const [languages, setLanguages] = useState<string[]>([]);
  const getUserPreferedLanguageFromLTI = useLearnerStore(
    (state) => state.getUserPreferedLanguageFromLTI,
  );

  useEffect(() => {
    async function fetchData() {
      if (!assignmentId) return;

      try {
        const supportedLanguages = await getSupportedLanguages(assignmentId);
        setLanguages(supportedLanguages);

        const user = await getUser();
        if (user) {
          setRole(user.role);
          setReturnUrl(user.returnUrl || "");
        }

        const userPreferedLanguageFromLTI =
          await getUserPreferedLanguageFromLTI();
        if (
          userPreferedLanguageFromLTI &&
          supportedLanguages.length > 0 &&
          !userPreferedLanguage
        ) {
          setUserPreferedLanguage(userPreferedLanguageFromLTI);
        }
      } catch (error) {
        toast.error("Failed to fetch data.");
      }
    }

    void fetchData();
  }, [assignmentId]);

  const handleChangeLanguage = (selectedLanguage: string) => {
    if (selectedLanguage && selectedLanguage !== userPreferedLanguage) {
      setUserPreferedLanguage(selectedLanguage);

      if (!isInQuestionPage && !isAttemptPage && !isSuccessPage)
        router.replace(`${pathname}?lang=${selectedLanguage}`, undefined);
    }
  };

  const CheckNoFlaggedQuestions = useCallback(() => {
    const flaggedQuestions = questions.filter((q) => q.status === "flagged");
    if (flaggedQuestions.length > 0) {
      setToggleWarning(true);
    } else {
      if (questions.every((q) => editedQuestionsOnly([q]).length > 0)) {
        void handleSubmitAssignment();
      } else {
        setToggleEmptyWarning(true);
        setToggleWarning(true);
      }
    }
  }, [questions]);

  const handleCloseModal = () => {
    setToggleWarning(false);
  };

  const handleConfirmSubmission = () => {
    setToggleWarning(false);
    void handleSubmitAssignment();
  };

  const handleProgressUpdate = (
    status: "processing" | "completed" | "failed",
    progress: number,
    message: string,
  ) => {
    setGradingProgress({
      isOpen: true,
      progress,
      message,
      status,
    });
  };

  const handleSubmitAssignment = useCallback(async () => {
    let responsesForQuestions: QuestionAttemptRequestWithId[] = [];
    try {
      responsesForQuestions = questions.map((q) => ({
        id: q.id,
        learnerTextResponse: q.learnerTextResponse || "",
        learnerUrlResponse: q.learnerUrlResponse || "",
        learnerChoices:
          role === "author"
            ? q.choices
                ?.map((choice, index) =>
                  q.learnerChoices?.includes(String(index))
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
        learnerFileResponse: q.learnerFileResponse || [],
        learnerPresentationResponse: q.presentationResponse ?? null,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      toast.error(`Error processing responses: ${errorMessage}`);
      console.error("Error processing responses:", error);
      return;
    }

    setSubmitting(true);
    setGradingProgress({
      isOpen: true,
      progress: 0,
      message: "Preparing submission...",
      status: "processing",
    });

    if (!assignmentId) {
      toast.error("Assignment ID is missing.");
      return;
    }

    if (activeAttemptId === null) {
      toast.error("Active attempt ID is missing.");
      setSubmitting(false);
      setGradingProgress({ ...gradingProgress, isOpen: false });
      return;
    }

    let res: SubmitAssignmentResponse | undefined;
    try {
      res = await submitAssignment(
        assignmentId,
        activeAttemptId,
        responsesForQuestions,
        userPreferedLanguage,
        role === "author" ? authorQuestions : undefined,
        role === "author" ? authorAssignmentDetails : undefined,
        undefined,
        handleProgressUpdate,
      );
      // Process the response immediately after getting it
      if (res) {
        const { grade, feedbacksForQuestions } = res;
        setTotalPointsEarned(res.totalPointsEarned);
        setTotalPointsPossible(res.totalPossiblePoints);
        if (grade !== undefined) {
          setGrade(grade * 100);
        }
        if (role === "learner") {
          setShowSubmissionFeedback(res.showSubmissionFeedback);
        }
        for (const question of questions) {
          const updatedQuestion = {
            ...question,
            learnerChoices: responsesForQuestions.find(
              (q) => q.id === question.id,
            )?.learnerChoices,
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
        if (role === "learner") {
          clearLearnerAnswers();
        }
        useLearnerStore.getState().setActiveQuestionNumber(null);
        router.push(`/learner/${assignmentId}/successPage/${res.id}`);

        setTimeout(() => {
          setGradingProgress({ ...gradingProgress, isOpen: false });
          useLearnerStore.getState().setUserPreferedLanguage(null);
          router.push(`/learner/${assignmentId}/successPage/${res.id}`);
        }, 500);
      }
    } catch (error) {
      setSubmitting(false);
      setTimeout(() => {
        setGradingProgress({ ...gradingProgress, isOpen: false });
      }, 2000);
      return;
    }
  }, [
    questions,
    role,
    userPreferedLanguage,
    assignmentId,
    activeAttemptId,
    authorQuestions,
    authorAssignmentDetails,
    setTotalPointsEarned,
    setTotalPointsPossible,
    setGrade,
    setShowSubmissionFeedback,
    setQuestion,
    clearGithubStore,
    clearLearnerAnswers,
    router,
    gradingProgress,
  ]);

  useEffect(() => {
    if (userPreferedLanguage && !isInQuestionPage && !isSuccessPage) {
      router.replace(`${pathname}?lang=${userPreferedLanguage}`, undefined);
    }
  }, [userPreferedLanguage]);

  // Listen for custom submit event from question navigation
  useEffect(() => {
    const handleSubmitEvent = () => {
      CheckNoFlaggedQuestions();
    };

    window.addEventListener("triggerAssignmentSubmission", handleSubmitEvent);

    return () => {
      window.removeEventListener(
        "triggerAssignmentSubmission",
        handleSubmitEvent,
      );
    };
  }, [CheckNoFlaggedQuestions]);

  return (
    <>
      <header className="border-b border-gray-300 w-full px-4 sm:px-6 py-4 sm:py-6 min-h-[80px] sm:h-[100px]">
        {/* Mobile Layout */}
        <div className="flex flex-col gap-3 sm:hidden">
          {/* Top row: Icon + Title */}
          <div className="flex items-center gap-3">
            <SNIcon />
            <Title className="text-base font-semibold truncate flex-1">
              {assignmentDetails?.name || "Untitled Assignment"}
            </Title>
          </div>

          {/* Bottom row: Actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              {!isSuccessPage && role === "learner" && (
                <div className="flex-1 max-w-[140px]">
                  <Dropdown
                    items={languages.map((lang) => ({
                      label: getLanguageName(lang),
                      value: lang,
                    }))}
                    selectedItem={userPreferedLanguage}
                    setSelectedItem={handleChangeLanguage}
                    placeholder="Language"
                  />
                </div>
              )}
              {isAttemptPage || isInQuestionPage ? (
                <Button
                  className="btn-tertiary text-xs px-3 py-2"
                  onClick={() => router.push(`/learner/${assignmentId}`)}
                >
                  Back
                </Button>
              ) : null}
            </div>

            {isInQuestionPage ? (
              <div className="relative group">
                <Button
                  disabled={buttonStatus.disabled}
                  className="disabled:opacity-70 btn-secondary text-sm px-4 py-2"
                  onClick={CheckNoFlaggedQuestions}
                >
                  {submitting && !gradingProgress.isOpen ? (
                    <Spinner className="w-6" />
                  ) : (
                    "Submit"
                  )}
                </Button>
                {buttonStatus.reason && (
                  <div className="absolute top-full mt-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                    <div className="bg-gray-800 text-white text-xs rounded-md px-3 py-2 whitespace-nowrap max-w-[200px]">
                      {buttonStatus.reason}
                      <div className="absolute bottom-full right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-gray-800"></div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {returnUrl && pathname.includes("successPage") ? (
            <Link
              href={returnUrl}
              className="px-4 py-2 bg-violet-100 hover:bg-violet-200 text-violet-800 border rounded-md transition flex items-center justify-center gap-2 text-sm"
            >
              Return to Course
            </Link>
          ) : null}
        </div>

        {/* Desktop Layout */}
        <div className="hidden sm:flex justify-between items-center h-full">
          <div className="flex">
            <div className="flex justify-center gap-x-6 items-center">
              <SNIcon />
              <Title className="text-lg font-semibold">
                {assignmentDetails?.name || "Untitled Assignment"}
              </Title>
            </div>
          </div>

          <div className="flex items-center gap-x-4">
            {!isSuccessPage && role === "learner" && (
              <Dropdown
                items={languages.map((lang) => ({
                  label: getLanguageName(lang),
                  value: lang,
                }))}
                selectedItem={userPreferedLanguage}
                setSelectedItem={handleChangeLanguage}
                placeholder="Select language"
              />
            )}
            {isAttemptPage || isInQuestionPage ? (
              <Button
                className="btn-tertiary"
                onClick={() => router.push(`/learner/${assignmentId}`)}
              >
                Return to Assignment Details
              </Button>
            ) : null}
            {isInQuestionPage ? (
              <div className="relative group">
                <Button
                  disabled={buttonStatus.disabled}
                  className="disabled:opacity-70 btn-secondary"
                  onClick={CheckNoFlaggedQuestions}
                >
                  {submitting && !gradingProgress.isOpen ? (
                    <Spinner className="w-8" />
                  ) : (
                    "Submit assignment"
                  )}
                </Button>
                {buttonStatus.reason && (
                  <div className="absolute top-full mt-2 left-1/8 transform -translate-x-1/4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                    <div className="bg-gray-800 text-white text-sm rounded-md px-3 py-2 whitespace-nowrap">
                      {buttonStatus.reason}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-gray-800"></div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {returnUrl && pathname.includes("successPage") ? (
            <Link
              href={returnUrl}
              className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 border rounded-md transition flex items-center gap-2"
            >
              Return to Course
            </Link>
          ) : null}
        </div>

        <WarningAlert
          isOpen={toggleWarning}
          onClose={handleCloseModal}
          onConfirm={handleConfirmSubmission}
          description={`You have ${
            toggleEmptyWarning ? "unanswered" : "flagged"
          } questions. Are you sure you want to submit?`}
        />
      </header>

      <GradingProgressModal
        isOpen={gradingProgress.isOpen}
        progress={gradingProgress.progress}
        message={gradingProgress.message}
        status={gradingProgress.status}
      />
    </>
  );
}

export default LearnerHeader;
