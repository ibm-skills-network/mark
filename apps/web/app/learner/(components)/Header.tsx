"use client";

import { getLanguageName } from "@/app/Helpers/getLanguageName";
import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import Dropdown from "@/components/Dropdown";
import Spinner from "@/components/svgs/Spinner";
import WarningAlert from "@/components/WarningAlert";
import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import {
  getSupportedLanguages,
  getUser,
  submitAssignment,
} from "@/lib/talkToBackend";
import { editedQuestionsOnly } from "@/lib/utils";
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
import { useEffect, useState } from "react";
import Button from "../../../components/Button";

function LearnerHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [
    questions,
    setQuestion,
    setShowSubmissionFeedback,
    activeAttemptId,
    setTotalPointsEarned,
    setTotalPointsPossible,
  ] = useLearnerStore((state) => [
    state.questions,
    state.setQuestion,
    state.setShowSubmissionFeedback,
    state.activeAttemptId,
    state.setTotalPointsEarned,
    state.setTotalPointsPossible,
  ]);
  const clearGithubStore = useGitHubStore((state) => state.clearGithubStore);
  const authorQuestions = getStoredData<QuestionStore[]>("questions", []);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const [userPreferedLanguage, setUserPreferedLanguage] = useLearnerStore(
    (state) => [state.userPreferedLanguage, state.setUserPreferedLanguage],
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
        console.error(error);
      }
    }

    void fetchData();
  }, [assignmentId]);

  const handleChangeLanguage = (selectedLanguage: string) => {
    if (selectedLanguage && selectedLanguage !== userPreferedLanguage) {
      // Update the learner’s preferred language in the store.
      setUserPreferedLanguage(selectedLanguage);
      // Optionally update the URL query without a full reload (using shallow routing).
      if (!isInQuestionPage && !isAttemptPage && !isSuccessPage)
        router.replace(`${pathname}?lang=${selectedLanguage}`, undefined);
    }
  };

  const CheckNoFlaggedQuestions = () => {
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
  };

  const handleCloseModal = () => {
    setToggleWarning(false);
  };

  const handleConfirmSubmission = () => {
    setToggleWarning(false);
    void handleSubmitAssignment();
  };

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
        learnerFileResponse: q.learnerFileResponse || [],
      }),
    );
    setSubmitting(true);
    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
      userPreferedLanguage,
      role === "author" ? authorQuestions : undefined,
      role === "author" ? authorAssignmentDetails : undefined,
    );
    setSubmitting(false);
    const { grade, feedbacksForQuestions } = res;
    setTotalPointsEarned(res.totalPointsEarned);
    setTotalPointsPossible(res.totalPossiblePoints);
    setGrade(grade * 100);
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
            points: feedback.totalPoints,
            feedback: feedback.feedback,
            questionId: feedback.questionId,
            assignmentAttemptId: activeAttemptId,
            learnerResponse: null,
          },
        ],
      });
    }
    clearGithubStore();
    useLearnerStore.getState().setActiveQuestionNumber(null);
    setTimeout(() => {
      useLearnerStore.getState().setUserPreferedLanguage(null);
    }, 1000);
    router.push(`/learner/${assignmentId}/successPage/${res.id}`);
  }

  useEffect(() => {
    if (userPreferedLanguage && !isInQuestionPage && !isSuccessPage) {
      router.replace(`${pathname}?lang=${userPreferedLanguage}`, undefined);
    }
  }, [userPreferedLanguage]);

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 flex justify-between h-[100px]">
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
          <Button
            disabled={editedQuestionsOnly(questions).length === 0 || submitting}
            className="disabled:opacity-70 btn-secondary"
            onClick={CheckNoFlaggedQuestions}
          >
            {submitting ? <Spinner className="w-8" /> : "Submit assignment"}
          </Button>
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
      {/* Modal for confirming submission when there are flagged questions */}
      <WarningAlert
        isOpen={toggleWarning}
        onClose={handleCloseModal}
        onConfirm={handleConfirmSubmission}
        description={`You have ${
          toggleEmptyWarning ? "unanswered" : "flagged"
        } questions. Are you sure you want to submit?`}
      />
    </header>
  );
}

export default LearnerHeader;
