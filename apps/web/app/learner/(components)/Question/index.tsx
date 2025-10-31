"use client";

import animationData from "@/animations/LoadSN.json";
import Loading from "@/components/Loading";
import {
  AssignmentAttemptWithQuestions,
  QuestionDisplayType,
} from "@/config/types";
import { cn } from "@/lib/strings";
import { getAssignment } from "@/lib/talkToBackend";
import { useDebugLog } from "@/lib/utils";
import { useAppConfig } from "@/stores/appConfig";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import Overview from "./Overview";
import QuestionContainer from "./QuestionContainer";
import TipsView from "./TipsView";

interface Props extends ComponentPropsWithoutRef<"div"> {
  attempt: AssignmentAttemptWithQuestions;
  assignmentId: number;
}

function QuestionPage(props: Props) {
  const { attempt, assignmentId } = props;
  const { questions, id, expiresAt } = attempt;
  const debugLog = useDebugLog();
  const router = useRouter();
  const questionsStore = useLearnerStore((state) => state.questions);

  const setLearnerStore = useLearnerStore((state) => state.setLearnerStore);
  const setQuestions = useLearnerStore((state) => state.setQuestions);
  const [assignmentDetails, setAssignmentDetails] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.setAssignmentDetails],
  );
  const [pageState, setPageState] = useState<
    "loading" | "success" | "no-questions"
  >("loading");
  const tips = useAppConfig((state) => state.tips);
  const setTipsVersion = useAppConfig((state) => state.setTipsVersion);

  useEffect(() => {
    setTipsVersion("v1.0");
  }, []);

  useEffect(() => {
    const fetchAssignment = async () => {
      const assignment = await getAssignment(assignmentId);

      if (assignment) {
        if (
          !assignmentDetails ||
          assignmentDetails.id !== assignment.id ||
          JSON.stringify(assignmentDetails) !== JSON.stringify(assignment)
        ) {
          setAssignmentDetails({
            id: assignment.id,
            name: assignment.name,
            numAttempts: assignment.numAttempts,
            passingGrade: assignment.passingGrade,
            allotedTimeMinutes: assignment.allotedTimeMinutes,
            questionDisplay: assignment.questionDisplay,
            introduction: assignment.introduction,
            instructions: assignment.instructions,
            gradingCriteriaOverview: assignment.gradingCriteriaOverview,
            questions: assignment.questions,
            graded: assignment.graded,
            published: assignment.published,
            questionOrder: assignment.questionOrder,
            updatedAt: assignment.updatedAt,
          });
        }
      } else {
        router.push(`/learner/${assignmentId}`);
      }
    };

    if (
      !assignmentDetails ||
      assignmentDetails.id !== assignmentId ||
      assignmentDetails.questionDisplay === undefined
    ) {
      void fetchAssignment();
    }
    const questionsWithStatus = questions.map((question) => ({
      ...question,
      status: question.status ?? "unedited",
    }));

    const expiresAtMs = expiresAt
      ? typeof expiresAt === "string"
        ? new Date(expiresAt).getTime()
        : expiresAt instanceof Date
          ? expiresAt.getTime()
          : undefined
      : undefined;
    const normalizedExpiresAt =
      typeof expiresAtMs === "number" && !Number.isNaN(expiresAtMs)
        ? expiresAtMs
        : undefined;

    debugLog("attemptId, expiresAt", id, normalizedExpiresAt);

    setQuestions(questionsWithStatus);

    const currentStoreUpdate = {
      activeAttemptId: id,
      expiresAt: normalizedExpiresAt,
    };

    const hasOtherChanges =
      id !== useLearnerStore.getState().activeAttemptId ||
      normalizedExpiresAt !== useLearnerStore.getState().expiresAt;
    if (hasOtherChanges) {
      setLearnerStore(currentStoreUpdate);
    }
    if (questions.length) {
      setPageState("success");
    } else {
      setPageState("no-questions");
    }
  }, [
    assignmentId,
    assignmentDetails,
    questions,
    id,
    expiresAt,
    setQuestions,
    setLearnerStore,
    setAssignmentDetails,
  ]);

  const [activeQuestionNumber] = useLearnerStore((state) => [
    state.activeQuestionNumber,
  ]);

  if (pageState === "loading") {
    return <Loading animationData={animationData} />;
  }
  if (pageState === "no-questions") {
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>No questions found.</h1>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-gray-50 flex-grow min-h-0 flex flex-col md:grid gap-2 md:gap-4",
        tips ? "md:grid-cols-[260px_1fr_265px]" : "md:grid-cols-[260px_1fr]",
      )}
    >
      <div className="md:rounded-md h-auto pt-3 md:pt-6 px-3 md:px-4 w-full md:w-auto border-b md:border-b-0 bg-white md:bg-transparent">
        <Overview questions={questionsStore} />
      </div>

      <div
        className={`flex flex-col gap-y-3 md:gap-y-5 py-3 md:py-6 overflow-y-auto px-3 md:pl-4 h-full ${
          tips ? "md:pr-4" : "md:pr-14"
        }`}
      >
        {assignmentDetails?.questionDisplay === "ALL_PER_PAGE"
          ? questionsStore.map((question, index) => (
              <QuestionContainer
                key={index}
                questionNumber={index + 1}
                questionId={question.id}
                question={question}
                questionDisplay={
                  assignmentDetails?.questionDisplay ??
                  QuestionDisplayType.ALL_PER_PAGE
                }
                lastQuestionNumber={questionsStore.length}
              />
            ))
          : questionsStore.map((question, index) =>
              index + 1 === activeQuestionNumber ? (
                <QuestionContainer
                  key={index}
                  questionNumber={index + 1}
                  questionId={question.id}
                  question={question}
                  questionDisplay={
                    assignmentDetails?.questionDisplay ??
                    QuestionDisplayType.ONE_PER_PAGE
                  }
                  lastQuestionNumber={questionsStore.length}
                />
              ) : null,
            )}
      </div>
      {tips && (
        <div className="md:rounded-md h-auto pt-3 md:pt-6 px-3 md:px-0 w-full md:w-auto border-t md:border-t-0 bg-white md:bg-transparent">
          <TipsView />
        </div>
      )}
    </div>
  );
}

export default QuestionPage;
