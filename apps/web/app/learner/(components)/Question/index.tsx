"use client";

import animationData from "@/animations/LoadSN.json";
import { decodeFields } from "@/app/Helpers/decoder";
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
  const [assignmentDetails, setAssignmentDetails] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.setAssignmentDetails]
  );
  const [pageState, setPageState] = useState<
    "loading" | "success" | "no-questions"
  >("loading");
  const tips = useAppConfig((state) => state.tips);
  const setTipsVersion = useAppConfig((state) => state.setTipsVersion);
  useEffect(() => {
    setTipsVersion("v1.0"); // change this version to update the tips
  });
  useEffect(() => {
    const fetchAssignment = async () => {
      const assignment = await getAssignment(assignmentId);

      if (assignment) {
        // Decode specific fields before using them
        const decodedFields = decodeFields({
          introduction: assignment.introduction,
          instructions: assignment.instructions,
          gradingCriteriaOverview: assignment.gradingCriteriaOverview,
        });

        // Merge decoded fields back into assignment
        const decodedAssignment = {
          ...assignment,
          ...decodedFields,
        };

        // Only set assignment details if they are different from the current state
        if (
          !assignmentDetails ||
          assignmentDetails.id !== decodedAssignment.id ||
          JSON.stringify(assignmentDetails) !==
            JSON.stringify(decodedAssignment)
        ) {
          setAssignmentDetails({
            id: decodedAssignment.id,
            name: decodedAssignment.name,
            numAttempts: decodedAssignment.numAttempts,
            passingGrade: decodedAssignment.passingGrade,
            allotedTimeMinutes: decodedAssignment.allotedTimeMinutes,
            questionDisplay: decodedAssignment.questionDisplay,
            introduction: decodedAssignment.introduction,
            instructions: decodedAssignment.instructions,
            gradingCriteriaOverview: decodedAssignment.gradingCriteriaOverview,
            questions: decodedAssignment.questions,
            graded: decodedAssignment.graded,
            published: decodedAssignment.published,
            questionOrder: decodedAssignment.questionOrder,
            updatedAt: decodedAssignment.updatedAt,
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

    debugLog("attemptId, expiresAt", id, new Date(expiresAt).getTime());

    const currentStore = {
      questions: questionsWithStatus,
      activeAttemptId: id,
      expiresAt: new Date(expiresAt).getTime(),
    };

    const hasChanges =
      JSON.stringify(questionsWithStatus) !== JSON.stringify(questions) ||
      id !== currentStore.activeAttemptId ||
      new Date(expiresAt).getTime() !== currentStore.expiresAt;
    if (hasChanges) {
      setLearnerStore(currentStore);
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
        "bg-gray-50 flex-grow min-h-0 grid gap-4",
        tips
          ? "grid-cols-1 md:grid-cols-[260px_1fr_265px]"
          : "grid-cols-1 md:grid-cols-[260px_1fr]"
      )}
    >
      <div className="rounded-md h-auto pt-6 px-4 w-full md:w-auto">
        <Overview questions={questionsStore} />
      </div>
      {/* Questions section that takes the remaining space */}
      <div
        className={`flex flex-col gap-y-5 py-6 overflow-y-auto pl-4 h-full ${
          tips ? "pr-4" : "pr-14"
        }`}
      >
        {assignmentDetails?.questionDisplay === "ALL_PER_PAGE"
          ? // Display all questions
            questionsStore.map((question, index) => (
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
          : // Display one question per page
            questionsStore.map((question, index) =>
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
              ) : null
            )}
      </div>
      {tips && (
        <div className="rounded-md h-auto pt-6 w-full md:w-auto">
          <TipsView />
        </div>
      )}
    </div>
  );
}

export default QuestionPage;
