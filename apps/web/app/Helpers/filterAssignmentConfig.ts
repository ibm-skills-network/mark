import { ReplaceAssignmentRequest } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";

export const useFilteredAssignmentConfig = (): ReplaceAssignmentRequest => {
  const {
    questionDisplay,
    graded,
    numAttempts,
    passingGrade,
    allotedTimeMinutes,
    displayOrder,
  } = useAssignmentConfig((state) => ({
    questionDisplay: state.questionDisplay,
    graded: state.graded,
    numAttempts: state.numAttempts,
    passingGrade: state.passingGrade,
    allotedTimeMinutes: state.allotedTimeMinutes,
    displayOrder: state.displayOrder,
  }));

  const { introduction, instructions, questionOrder, updatedAt, questions } =
    useAuthorStore((state) => ({
      introduction: state.introduction,
      instructions: state.instructions,
      questionOrder: state.questionOrder,
      updatedAt: state.updatedAt,
      questions: state.questions,
    }));

  return {
    questionDisplay,
    graded,
    numAttempts,
    passingGrade,
    allotedTimeMinutes,
    displayOrder,
    introduction,
    instructions,
    questionOrder,
    published: false,
    updatedAt: updatedAt,
    questions: questions,
  };
};
