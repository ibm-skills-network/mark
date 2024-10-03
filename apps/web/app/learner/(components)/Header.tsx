"use client";

import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import Spinner from "@/components/svgs/Spinner";
import WarningAlert from "@/components/WarningAlert";
import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import { submitAssignment } from "@/lib/talkToBackend";
import { editedQuestionsOnly } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Button from "../../../components/Button";
import Breadcrumbs from "./Breadcrumbs";

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

  const assignmentId = assignmentDetails?.id;
  const isInQuestionPage = pathname.includes("questions");
  const [title, setTitle] = useState<string>("Auto-Graded Assignment");
  const [toggleWarning, setToggleWarning] = useState<boolean>(false);
  const [toggleEmptyWarning, setToggleEmptyWarning] = useState<boolean>(false);
  useEffect(() => {
    if (assignmentDetails) {
      setTitle(assignmentDetails.name);
    }
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
    const responsesForOnlyEditedQuestions = editedQuestionsOnly(questions);
    const responsesForQuestions: QuestionAttemptRequestWithId[] =
      responsesForOnlyEditedQuestions.map((q) => ({
        id: q.id,
        learnerTextResponse: q.learnerTextResponse || undefined,
        learnerUrlResponse: q.learnerUrlResponse || undefined,
        learnerChoices: q.learnerChoices || undefined,
        learnerAnswerChoice:
          q.learnerAnswerChoice !== undefined
            ? q.learnerAnswerChoice
            : undefined,
        learnerFileResponse: q.learnerFileResponse || undefined,
      }));
    setSubmitting(true);
    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
      authorQuestions,
      authorAssignmentDetails,
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
    setShowSubmissionFeedback(res.showSubmissionFeedback); // set showSubmissionFeedback boolean in zustand store
    for (const feedback of feedbacksForQuestions || []) {
      setQuestion({
        id: feedback.questionId,
        questionResponses: [
          {
            id: feedback.id,
            learnerAnswerChoice: responsesForOnlyEditedQuestions.find(
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
    router.push(`/learner/${assignmentId}/successPage/${res.id}`);
  }

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 flex justify-between h-[100px]">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title className="text-lg font-semibold">{title}</Title>
          {pathname.includes("questions") && (
            <Breadcrumbs
              homeHref={pathname.replace(/\/questions.*/, "")}
              pages={[
                {
                  name: "Questions",
                  href: pathname,
                  current: true,
                },
              ]}
            />
          )}
        </div>
      </div>

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
