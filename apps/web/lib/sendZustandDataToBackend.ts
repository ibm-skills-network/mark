import { toast } from "sonner";
import { updateAssignment } from "./talkToBackend";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import { ReplaceAssignmentRequest } from "@/config/types";

/**
 * Updates the assignment with the details from the introduction page
 * and redirects to the questions page
 **/
export async function publishStepOneData() {
  const {
    introduction,
    instructions,
    gradingCriteriaOverview,
    activeAssignmentId,
  } = useAuthorStore.getState();

  const assignment: Partial<ReplaceAssignmentRequest> = {
    introduction,
    instructions,
    gradingCriteriaOverview,
  };
  const modified = await updateAssignment(assignment, activeAssignmentId);
  if (modified) {
    return modified;
  }
  toast.error("Failed to update assignment");
  return false;
}

export async function publishStepTwoData() {
  const {
    graded,
    allotedTimeMinutes,
    strictTimeLimit,
    timeEstimateMinutes,
    passingGrade,
    displayOrder,
    numAttempts,
    questionDisplay,
  } = useAssignmentConfig.getState();

  const { showAssignmentScore, showQuestionScore, showSubmissionFeedback } =
    useAssignmentFeedbackConfig.getState();

  const { activeAssignmentId } = useAuthorStore.getState();

  const assignment: Partial<ReplaceAssignmentRequest> = {
    graded,
    allotedTimeMinutes: strictTimeLimit ? allotedTimeMinutes : null,
    timeEstimateMinutes: timeEstimateMinutes || null,
    passingGrade: passingGrade,
    displayOrder: displayOrder || "DEFINED",
    numAttempts: numAttempts,
    // --- feedback settings ---
    showAssignmentScore,
    showQuestionScore,
    showSubmissionFeedback: showSubmissionFeedback,
    questionDisplay,
    // -------------------------
  };
  // if attempts is -1, it means unlimited attempts, so we don't send that to the backend(default is unlimited)
  const modified = await updateAssignment(assignment, activeAssignmentId);
  if (modified) {
    return modified;
  }
  toast.error("Failed to update assignment");
  return false;
}
