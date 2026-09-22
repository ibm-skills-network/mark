"use client";

import { useMarkChatStore } from "@/app/chatbot/store/useMarkChatStore";
import { MarkChatToggleButton } from "@/components/MarkChatToggleButton";
import { getLanguageName } from "@/app/Helpers/getLanguageName";
import { readAuthorPreviewPayload } from "@/app/learner/utils/authorPreview";
import Dropdown from "@/components/Dropdown";
import Spinner from "@/components/svgs/Spinner";
import ThemeToggle from "@/components/ThemeToggle";
import WarningAlert from "@/components/WarningAlert";
import type {
  QuestionAttemptRequestWithId,
  ReplaceAssignmentRequest,
  SubmitAssignmentResponse,
} from "@/config/types";
import { learnerSuccessPath } from "@/lib/author-session";
import {
  getAttempt,
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Button from "../../../components/Button";
import GradingProgressModal, {
  type ProgressState,
} from "./GradingProgressModal";
import {
  isAttemptAlreadySubmittedError,
  isGradingStreamLostError,
} from "@/lib/learner";

const TRANSLATION_PREVIEW_DISABLED_TOOLTIP =
  "Translations are only available after publishing this assignment. Publish to preview translated content.";

function LearnerHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The URL is authoritative for the assignment. The persisted details store
  // can still contain the previous assignment during SPA navigation, before
  // the current assignment has finished loading.
  const { assignmentId, assignmentIdParam } = useAssignmentId();
  const isAuthorPreview = searchParams.get("authorMode") === "true";
  const authorPreviewPayload = assignmentId
    ? readAuthorPreviewPayload(assignmentId)
    : null;
  const [submitting, setSubmitting] = useState(false);
  const [showGradingModal, setShowGradingModal] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState<number | null>(null);
  const [progressData, setProgressData] = useState<ProgressState>({
    status: "idle",
    progress: 0,
    currentStage: "Preparing to grade your assignment...",
  });

  const [
    questions,
    setQuestion,
    setQuestions,
    setShowSubmissionFeedback,
    activeAttemptId,
    setTotalPointsEarned,
    setTotalPointsPossible,
    clearLearnerAnswers,
  ] = useLearnerStore((state) => [
    state.questions,
    state.setQuestion,
    state.setQuestions,
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
  const [storedAssignmentDetails, setGrade, setPassed] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.setGrade, state.setPassed],
  );
  const assignmentDetails =
    (isAuthorPreview ? authorPreviewPayload?.assignmentDetails : null) ??
    (storedAssignmentDetails?.id === assignmentId
      ? storedAssignmentDetails
      : null);
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

  const [returnUrl, setReturnUrl] = useState<string>("");
  const authorQuestions = authorPreviewPayload?.questions ?? questions;
  const authorAssignmentDetails: ReplaceAssignmentRequest | undefined =
    authorPreviewPayload?.assignmentDetails
      ? (authorPreviewPayload.assignmentDetails as ReplaceAssignmentRequest)
      : assignmentDetails
        ? (assignmentDetails as ReplaceAssignmentRequest)
        : undefined;
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

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!assignmentId) return;

      try {
        const supportedLanguages = await getSupportedLanguages(assignmentId);
        if (cancelled) return;
        const sortedLanguages = [...supportedLanguages].sort((a, b) =>
          getLanguageName(a).localeCompare(getLanguageName(b)),
        );
        setLanguages(sortedLanguages);

        const user = await getUser();
        if (cancelled) return;
        if (user) {
          setRole(user.role);
          setReturnUrl(user.returnUrl || "");
        }

        const userPreferedLanguageFromLTI =
          await getUserPreferedLanguageFromLTI();
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  // Reconcile content once per assignment/attempt/language. Reading the question
  // list from the store avoids restarting a pending request on every keystroke.
  const reconciledLanguageRef = useRef<string | null>(null);
  const questionCount = questions.length;
  useEffect(() => {
    if (!isInQuestionPage || !assignmentId || !activeAttemptId) return;
    if (!userPreferedLanguage || questionCount === 0) return;
    const key = `${assignmentId}:${activeAttemptId}:${userPreferedLanguage}`;
    if (reconciledLanguageRef.current === key) return;
    if (
      useLearnerStore
        .getState()
        .questions.some(
          (question) => question.translations?.[userPreferedLanguage],
        )
    )
      return;

    reconciledLanguageRef.current = key;
    let cancelled = false;
    void getAttempt(
      assignmentId,
      activeAttemptId,
      undefined,
      userPreferedLanguage,
    )
      .then((attempt) => {
        const current = useLearnerStore.getState();
        if (
          !cancelled &&
          current.activeAttemptId === activeAttemptId &&
          current.userPreferedLanguage === userPreferedLanguage &&
          attempt?.questions?.length
        ) {
          setQuestions(attempt.questions);
        }
      })
      .catch(() => {
        // The learner can retry by switching language or reopening the attempt.
        // Preserve their current content and drafts on a failed read.
      });
    return () => {
      cancelled = true;
      if (reconciledLanguageRef.current === key) {
        reconciledLanguageRef.current = null;
      }
    };
  }, [
    isInQuestionPage,
    assignmentId,
    activeAttemptId,
    userPreferedLanguage,
    questionCount,
    setQuestions,
  ]);

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
    // The header's Submit button is disabled on this status, but the in-page
    // submit control reaches this handler through a window event and has no
    // such button state to disable. Re-checking here makes this the one gate
    // every submission passes, so an upload still in flight (or a half-filled
    // attempt) cannot be posted from the page body.
    const submitStatus = getSubmitButtonStatus(
      questions,
      submitting,
      isUploadingFiles,
      assignmentDetails?.requireAllQuestions,
      assignmentDetails?.optionalQuestionIds,
    );
    if (submitStatus.disabled) {
      toast.error(submitStatus.reason);
      return;
    }

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
  }, [questions, assignmentDetails, submitting, isUploadingFiles]);

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
    setProgressData({
      status: "processing",
      progress: 0,
      currentStage: "Preparing to grade your assignment...",
    });
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
        (status, progress, message, metadata) => {
          // "processing" and "stalled" are non-terminal: the stream is still
          // open and grading is still (or again) advancing, so a frame with
          // no metadata (e.g. a bare "Reconnecting..." message) must not wipe
          // out the question list/progress the learner already saw. Terminal
          // statuses ("completed", "failed", "disconnected") replace outright
          // — each is a definite transition, not an update to carry forward.
          const isNonTerminal = status === "processing" || status === "stalled";
          setProgressData((prev) => ({
            status,
            progress: status === "completed" ? 100 : progress,
            currentStage:
              status === "completed" ? "Grading complete!" : message,
            currentQuestion:
              metadata?.currentQuestion ??
              (isNonTerminal ? prev.currentQuestion : undefined),
            totalQuestions:
              metadata?.totalQuestions ??
              (isNonTerminal ? prev.totalQuestions : undefined),
            gradingState:
              metadata?.gradingState ??
              (isNonTerminal ? prev.gradingState : undefined),
          }));
        },
        undefined,
      );

      if (res && typeof res.id === "number") {
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
        setPassed(res.passed ?? null);
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

        setTimeout(() => {
          setShowGradingModal(false);
          useLearnerStore.getState().setUserPreferedLanguage(null);
          router.push(learnerSuccessPath(assignmentId, res.id));
        }, 1000);
      } else {
        // submitAssignment resolved without a usable result: no payload at
        // all (e.g. an SSE finalize event carrying none), or one missing the
        // attempt id — navigating with an undefined id lands the learner on
        // /successPage/undefined and a 404 dialog. Without this branch
        // submitting/modal stay true forever and the grading modal spins with
        // no error and no exit.
        toast.error("We couldn't complete your submission. Please try again.");
        setSubmitting(false);
        setShowGradingModal(false);
        submitInFlightRef.current = false;
      }
    } catch (error) {
      setSubmitting(false);
      submitInFlightRef.current = false;

      if (isAttemptAlreadySubmittedError(error)) {
        // The attempt was already graded (this was a retried PATCH after a
        // timeout or lost stream). Show those results instead of an error.
        setShowGradingModal(false);
        router.push(learnerSuccessPath(assignmentId, error.attemptId));
        return;
      }

      if (isGradingStreamLostError(error)) {
        // The submission itself succeeded — only our view of it died. Leave
        // the modal up in its "lost contact" state so the learner can check
        // their results or report the problem, instead of dropping them back
        // onto the questions page with nothing to act on.
        return;
      }

      setTimeout(() => {
        setShowGradingModal(false);
      }, 2000);
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
    setPassed,
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

    // Storing the language above is what actually switches the UI: the
    // translator reads storage and the change event, not the URL. So the
    // routes that must not be re-navigated stop here, the way the sibling
    // `lang` sync already does. Replacing the URL of an attempt route re-runs
    // its server component, which is where an attempt gets created — that is
    // how a language change used to land a learner on a fresh attempt.
    if (isInQuestionPage || isAttemptPage || isSuccessPage) {
      return;
    }

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
  }, [
    isInQuestionPage,
    isAttemptPage,
    isSuccessPage,
    pathname,
    router,
    searchParams,
    userPreferedLanguage,
  ]);

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
      {/* Two layouts, picked by width. The single row needs ~960px of
          min-content (an untruncated assignment name, five nowrap controls),
          so it only runs from `lg` up; every narrower viewport — a phone, and
          a desktop browser inside a narrow course-player iframe — gets the
          stacked layout, which wraps. The route root is overflow-hidden, so a
          row that does not fit is clipped away rather than scrolled to. */}
      <header className="border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-full px-4 sm:px-6 py-4 lg:py-6 min-h-[80px] lg:h-[100px]">
        <div
          data-testid="learner-header-compact"
          className="flex flex-col gap-3 lg:hidden"
        >
          <div className="flex items-center gap-3 min-w-0">
            <SNIcon />
            <Title className="text-base font-semibold truncate flex-1 min-w-0">
              {assignmentDetails?.name || "Untitled Assignment"}
            </Title>
          </div>

          <div
            data-testid="learner-header-compact-controls"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              <ThemeToggle />
              {!isSuccessPage && (role === "learner" || isAuthorPreview) && (
                <>
                  {languages.length > 1 ? (
                    <div className="flex-1 min-w-[96px] max-w-[180px]">
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
              // Secondary controls wrap away first; the submit control never
              // shrinks and never wraps out of reach.
              <div
                data-testid="learner-header-compact-submit"
                className="relative group shrink-0"
              >
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

        <div
          data-testid="learner-header-wide"
          className="hidden lg:flex justify-between items-center gap-x-4 h-full"
        >
          <div data-testid="learner-header-wide-title" className="flex min-w-0">
            <div className="flex justify-center gap-x-6 items-center min-w-0">
              <SNIcon />
              {/* A flex item's automatic minimum size is its content, so an
                  untruncated name pushed the controls past the right edge. */}
              <Title className="text-lg font-semibold truncate">
                {assignmentDetails?.name || "Untitled Assignment"}
              </Title>
            </div>
          </div>

          <div
            data-testid="learner-header-wide-controls"
            className="flex items-center gap-x-4 shrink-0"
          >
            <ThemeToggle />
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
        progressData={progressData}
        onCheckResults={
          assignmentId && currentAttemptId
            ? () => {
                setShowGradingModal(false);
                router.push(
                  learnerSuccessPath(assignmentId, currentAttemptId),
                );
              }
            : undefined
        }
      />
    </>
  );
}

export default LearnerHeader;
