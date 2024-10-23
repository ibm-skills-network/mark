"use client";

import Loading from "@/components/Loading";
import type { AssignmentAttemptWithQuestions } from "@/config/types";
import { getAssignment } from "@/lib/talkToBackend";
import { useDebugLog } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import Overview from "./Overview";
import QuestionContainer from "./QuestionContainer";
import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";

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
    (state) => [state.assignmentDetails, state.setAssignmentDetails],
  );
  const [pageState, setPageState] = useState<
    "loading" | "success" | "no-questions"
  >("loading");

  useEffect(() => {
    const fetchAssignment = async () => {
      const assignment = await getAssignment(assignmentId);
      if (assignment) {
        // Only set assignment details if they are different from the current state
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
  useEffect(() => {
    handleJumpToQuestion(`item-${String(activeQuestionNumber)}`);
  }, [activeQuestionNumber]);

  if (pageState === "loading") {
    return <Loading />;
  }
  if (pageState === "no-questions") {
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>No questions found.</h1>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[260px_1fr] bg-gray-50 flex-grow min-h-0">
      {/* Overview section with fixed width */}
      <div className="rounded-md h-auto pt-12 px-4">
        <Overview questions={questionsStore} />
      </div>

      {/* Questions section that takes the remaining space */}
      <div className="flex flex-col gap-y-5 py-12 overflow-y-auto px-4 h-full">
        {/* Conditional rendering based on questionDisplay */}
        {assignmentDetails?.questionDisplay === "ALL_PER_PAGE"
          ? // Display all questions
            questionsStore.map((question, index) => (
              <QuestionContainer
                key={index}
                questionNumber={index + 1}
                questionId={question.id}
                question={question}
                questionDisplay={assignmentDetails.questionDisplay}
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
                  questionDisplay={assignmentDetails.questionDisplay}
                  lastQuestionNumber={questionsStore.length}
                />
              ) : null,
            )}
      </div>
    </div>
  );
}

export default QuestionPage;
