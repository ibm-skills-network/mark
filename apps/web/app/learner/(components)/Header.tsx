"use client";

import { useMarkChatStore } from "@/app/chatbot/store/useMarkChatStore";
import { MarkChatToggleButton } from "@/components/MarkChatToggleButton";
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
import {
  editedQuestionsOnly,
  getSubmitButtonStatus,
  hasLearnerResponse,
} from "@/lib/utils";
import {
  isSupportedUiLanguage,
  DEFAULT_UI_LANGUAGE,
  setStoredUiLanguage,
} from "@/lib/ui-language";
import {
  useAssignmentDetails,
  useGitHubStore,
  useLearnerStore,
} from "@/stores/learner";
import { useAssignmentId } from "@/hooks/use-assignment-id";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Link from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Button from "../../../components/Button";
import GradingProgressModal from "./GradingProgressModal";

const TRANSLATION_PREVIEW_DISABLED_TOOLTIP =
  "Translations are only available after publishing this assignment. Publish to preview translated content.";

function LearnerHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [showGradingModal, setShowGradingModal] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState<number | null>(null);
  const [currentGradingJobId, setCurrentGradingJobId] = useState<string | null>(
    null,
  );

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
  const isUploadingFiles = useLearnerStore((state) => state.isUploadingFiles);
  const buttonStatus = getSubmitButtonStatus(
    questions,
    submitting,
    isUploadingFiles,
    assignmentDetails?.requireAllQuestions,
    assignmentDetails?.optionalQuestionIds,
  );

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
  // The URL is authoritative for the assignment id. Reading it from a store
  // populated only on the overview route leaves deep links / hard refreshes
  // with a null id and silently drops the submit.
  const { assignmentId, assignmentIdParam } = useAssignmentId();
  // Guards re-entrancy: submit can be triggered by the button AND by a window
  // "triggerAssignmentSubmission" event, so a ref (not the async-stale
  // `submitting` state) prevents a double submission of the same attempt.
  const submitInFlightRef = useRef(false);
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

  const isAuthorPreview = searchParams.get("authorMode") === "true";

  useEffect(() => {
    async function fetchData() {
      if (!assignmentId) return;

      try {
        const supportedLanguages = await getSupportedLanguages(assignmentId);
        const sortedLanguages = [...supportedLanguages].sort((a, b) =>
          getLanguageName(a).localeCompare(getLanguageName(b)),
        );
        setLanguages(sortedLanguages);

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
    if (!selectedLanguage) return;
    if (selectedLanguage !== userPreferedLanguage) {
      setUserPreferedLanguage(selectedLanguage);
    }

    if (!isInQuestionPage && !isAttemptPage && !isSuccessPage) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("lang", selectedLanguage);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, undefined);
    }
  };

  const CheckNoFlaggedQuestions = useCallback(() => {
    const optionalQuestionSet = new Set(
      assignmentDetails?.optionalQuestionIds ?? [],
    );
    const requiredQuestions = questions.filter(
      (question) => !optionalQuestionSet.has(question.id),
    );
    const requiredResponses = requiredQuestions.filter(hasLearnerResponse);

    if (
      assignmentDetails?.requireAllQuestions &&
      requiredResponses.length < requiredQuestions.length
    ) {
      const unansweredCount =
        requiredQuestions.length - requiredResponses.length;
      toast.error(
        `All required questions must be answered before submitting (${unansweredCount} unanswered)`,
      );
      return;
    }

    const flaggedQuestions = questions.filter((q) => q.status === "flagged");
    if (flaggedQuestions.length > 0) {
      setToggleWarning(true);
    } else {
      if (requiredQuestions.every((q) => editedQuestionsOnly([q]).length > 0)) {
        void handleSubmitAssignment();
      } else {
        setToggleEmptyWarning(true);
        setToggleWarning(true);
      }
    }
  }, [questions, assignmentDetails]);

  const handleCloseModal = () => {
    setToggleWarning(false);
  };

  const handleConfirmSubmission = () => {
    setToggleWarning(false);
    void handleSubmitAssignment();
  };

  const handleSubmitAssignment = useCallback(async () => {
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
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
      submitInFlightRef.current = false;
      return;
    }

    setSubmitting(true);
    setShowGradingModal(true);
    setCurrentAttemptId(activeAttemptId);

    if (!assignmentId) {
      console.warn(
        "[learner] submit blocked: assignmentId missing from route",
        {
          assignmentIdParam,
          hasActiveAttemptId: activeAttemptId !== null,
          route: pathname,
        },
      );
      toast.error(
        "Something went wrong. Please reload the page or exit and relaunch the assignment.",
      );
      setShowGradingModal(false);
      setSubmitting(false);
      submitInFlightRef.current = false;
      return;
    }

    if (activeAttemptId === null) {
      toast.error("Active attempt ID is missing.");
      setSubmitting(false);
      setShowGradingModal(false);
      submitInFlightRef.current = false;
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
        () => {
          // Progress callback not used - grading progress shown via modal
        },
        (gradingJobId) => {
          setCurrentGradingJobId(gradingJobId);
          setCurrentAttemptId(activeAttemptId);
          setShowGradingModal(true);
        },
      );

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
          setShowGradingModal(false);
          useLearnerStore.getState().setUserPreferedLanguage(null);
          router.push(`/learner/${assignmentId}/successPage/${res.id}`);
        }, 500);
      } else {
        // submitAssignment resolved without a result (e.g. an SSE finalize
        // event carrying no payload). Without this branch submitting/modal stay
        // true forever and the grading modal spins with no error and no exit.
        toast.error("We couldn't complete your submission. Please try again.");
        setSubmitting(false);
        setShowGradingModal(false);
        submitInFlightRef.current = false;
      }
    } catch (error) {
      setSubmitting(false);
      setTimeout(() => {
        setShowGradingModal(false);
      }, 2000);
      submitInFlightRef.current = false;
      return;
    }
  }, [
    questions,
    role,
    userPreferedLanguage,
    assignmentId,
    assignmentIdParam,
    pathname,
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
  ]);

  useEffect(() => {
    if (
      userPreferedLanguage &&
      !isInQuestionPage &&
      !isAttemptPage &&
      !isSuccessPage
    ) {
      if (searchParams.get("lang") === userPreferedLanguage) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("lang", userPreferedLanguage);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, undefined);
    }
  }, [
    userPreferedLanguage,
    isInQuestionPage,
    isAttemptPage,
    isSuccessPage,
    pathname,
    router,
    searchParams,
  ]);

  useEffect(() => {
    if (!userPreferedLanguage || !isSupportedUiLanguage(userPreferedLanguage)) {
      return;
    }

    setStoredUiLanguage(userPreferedLanguage);

    const currentUiLanguage = searchParams.get("uiLang") || DEFAULT_UI_LANGUAGE;
    if (currentUiLanguage === userPreferedLanguage) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    if (userPreferedLanguage === DEFAULT_UI_LANGUAGE) {
      params.delete("uiLang");
    } else {
      params.set("uiLang", userPreferedLanguage);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, undefined);
  }, [pathname, router, searchParams, userPreferedLanguage]);

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
        <div className="flex flex-col gap-3 sm:hidden">
          <div className="flex items-center gap-3">
            <SNIcon />
            <Title className="text-base font-semibold truncate flex-1">
              {assignmentDetails?.name || "Untitled Assignment"}
            </Title>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              {!isSuccessPage && (role === "learner" || isAuthorPreview) && (
                <>
                  {languages.length > 1 ? (
                    <div className="flex-1 max-w-[180px]">
                      <Dropdown
                        items={languages.map((lang) => ({
                          label: getLanguageName(lang),
                          value: lang,
                        }))}
                        selectedItem={userPreferedLanguage}
                        setSelectedItem={handleChangeLanguage}
                        placeholder="Language"
                        disableUiTranslation={true}
                        disabled={isAuthorPreview}
                        disabledTooltip={
                          isAuthorPreview
                            ? TRANSLATION_PREVIEW_DISABLED_TOOLTIP
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                  <MarkChatToggleButton role="learner" />
                </>
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
                  {submitting && !showGradingModal ? (
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
            {!isSuccessPage && (role === "learner" || isAuthorPreview) && (
              <>
                {languages.length > 1 ? (
                  <Dropdown
                    items={languages.map((lang) => ({
                      label: getLanguageName(lang),
                      value: lang,
                    }))}
                    selectedItem={userPreferedLanguage}
                    setSelectedItem={handleChangeLanguage}
                    placeholder="Language"
                    disableUiTranslation={true}
                    disabled={isAuthorPreview}
                    disabledTooltip={
                      isAuthorPreview
                        ? TRANSLATION_PREVIEW_DISABLED_TOOLTIP
                        : undefined
                    }
                  />
                ) : null}
                <MarkChatToggleButton role="learner" />
              </>
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
                  {submitting && !showGradingModal ? (
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
        isOpen={showGradingModal}
        assignmentId={assignmentId || 0}
        attemptId={currentAttemptId}
        gradingJobId={currentGradingJobId}
      />
    </>
  );
}

export default LearnerHeader;
