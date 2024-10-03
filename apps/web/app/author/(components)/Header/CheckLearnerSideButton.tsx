import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import Tooltip from "@/components/Tooltip";
import { QuestionAuthorStore, QuestionStore } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import type { ComponentPropsWithoutRef, FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  disabled?: boolean;
}

const CheckLearnerSideButton: FC<Props> = (props) => {
  const { disabled } = props;
  const questions = useAuthorStore((state) => state.questions);
  const assignmentId = useAuthorStore((state) => state.activeAssignmentId);
  const assignmentConfigstate = useAssignmentConfig.getState(); // Direct access to the store
  const authorState = useAuthorStore.getState(); // Direct access to the author store
  const assignmentConfig = {
    questionDisplay: assignmentConfigstate.questionDisplay,
    graded: assignmentConfigstate.graded,
    numAttempts: assignmentConfigstate.numAttempts,
    passingGrade: assignmentConfigstate.passingGrade || 60, // ensure passingGrade is never undefined
    allotedTimeMinutes: assignmentConfigstate.allotedTimeMinutes,
    displayOrder: assignmentConfigstate.displayOrder,
    strictTimeLimit: assignmentConfigstate.strictTimeLimit,
    introduction: authorState.introduction,
    instructions: authorState.instructions,
  };
  const handleJumpToLearnerSide = (
    questions: QuestionAuthorStore[],
    assignmentId: number,
  ) => {
    const processedQuestions = processQuestions(questions);
    localStorage.setItem("questions", JSON.stringify(processedQuestions));
    localStorage.setItem("assignmentConfig", JSON.stringify(assignmentConfig));
    window.open(`/learner/${assignmentId}/questions?authorMode=true`, "_blank");
  };

  return (
    <Tooltip
      content={`${disabled ? "Please complete the assignment setup and question setup before checking the learner side" : "Check the learner side"}`}
      distance={-2.5}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => handleJumpToLearnerSide(questions, assignmentId)}
        className="text-sm font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
      >
        View Learner Side
      </button>
    </Tooltip>
  );
};

export default CheckLearnerSideButton;
