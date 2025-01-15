"use client";

import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import Spinner from "@/components/svgs/Spinner";
import WarningAlert from "@/components/WarningAlert";
import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import { getUser, submitAssignment } from "@/lib/talkToBackend";
import { editedQuestionsOnly } from "@/lib/utils";
import {
  useAssignmentDetails,
  useGitHubStore,
  useLearnerStore,
} from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Button from "../../../components/Button";
import Breadcrumbs from "./Breadcrumbs";
import Link from "next/link";

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
  const assignmentId = assignmentDetails?.id;
  const isInQuestionPage = pathname.includes("questions");
  const [toggleWarning, setToggleWarning] = useState<boolean>(false);
  const [toggleEmptyWarning, setToggleEmptyWarning] = useState<boolean>(false);
  const [role, setRole] = useState<string | undefined>(undefined);
  useEffect(() => {
    // get user role
    const getUserRole = async () => {
      const user = await getUser();
      if (user) {
        setRole(user.role);
        setReturnUrl(user.returnUrl || "");
      }
    };
    void getUserRole();
  });

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
        learnerChoices: q.learnerChoices || [],
        learnerAnswerChoice: q.learnerAnswerChoice ?? null,
        learnerFileResponse: q.learnerFileResponse || [],
      }),
    );

    setSubmitting(true);
    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
      role === "author" ? authorQuestions : undefined,
      role === "author" ? authorAssignmentDetails : undefined,
    );

    setSubmitting(false);
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

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 flex justify-between h-[100px]">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title className="text-lg font-semibold">
            {assignmentDetails?.name || "Untitled Assignment"}
          </Title>
          {(pathname.includes("questions") ||
            pathname.includes("attempts")) && (
            <Breadcrumbs
              homeHref={pathname.replace(/\/(questions|attempts).*/, "")}
              pages={[
                ...(pathname.includes("questions")
                  ? [
                      {
                        name: "Questions",
                        href: pathname.replace(/\/attempts.*/, ""),
                        current: !pathname.includes("attempts"),
                      },
                    ]
                  : []),
                ...(pathname.includes("attempts")
                  ? [{ name: "Attempts", href: pathname, current: true }]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
      {returnUrl && pathname.includes("successPage") && (
        <Link
          href={returnUrl}
          className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 border rounded-md transition flex items-center gap-2 shadow-lg"
        >
          Return to Course
        </Link>
      )}
      {activeAttemptId && isInQuestionPage && (
        <Button
          disabled={editedQuestionsOnly(questions).length === 0 || submitting}
          className="disabled:opacity-70"
          onClick={CheckNoFlaggedQuestions}
        >
          {submitting ? <Spinner className="w-8" /> : "Submit assignment"}
        </Button>
      )}

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
