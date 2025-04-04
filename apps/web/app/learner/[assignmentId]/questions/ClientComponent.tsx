"use client";

import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import type {
  Assignment,
  AssignmentDetails,
  QuestionStore,
} from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "@learnerComponents/Question";
import { useEffect } from "react";

interface ClientLearnerLayoutProps {
  assignmentId: number;
  role?: "learner" | "author";
}

const ClientLearnerLayout: React.FC<ClientLearnerLayoutProps> = ({
  assignmentId,
  role,
}) => {
  const setAssignmentDetails = useAssignmentDetails(
    (state) => state.setAssignmentDetails,
  );
  const setRole = useLearnerStore((state) => state.setRole);
  useEffect(() => {
    setRole(role || "learner");
  }, [role]);
  const assignmentDetails = getStoredData(
    "assignmentConfig",
    {},
  ) as AssignmentDetails;
  const questions = getStoredData("questions", []) as QuestionStore[];
  useEffect(() => {
    setAssignmentDetails({
      ...assignmentDetails,
      introduction: assignmentDetails.introduction || "",
      graded: assignmentDetails.graded || false,
      published: assignmentDetails.published || false,
      questionOrder: assignmentDetails.questionOrder || [],
      updatedAt:
        typeof assignmentDetails.updatedAt === "string"
          ? Date.parse(assignmentDetails.updatedAt)
          : assignmentDetails.updatedAt || Date.now(),
      passingGrade: assignmentDetails.passingGrade || 0,
    });
  }, [assignmentDetails, setAssignmentDetails]);
  // Render the questions page
  return (
    <main className="flex flex-col h-[calc(100vh-100px)]">
      <QuestionPage
        attempt={{
          id: generateTempQuestionId(), // genereate a random number for the attempt id
          assignmentId,
          submitted: false,
          questions,
          assignmentDetails,
          expiresAt:
            assignmentDetails?.strictTimeLimit === true
              ? new Date(
                  Date.now() +
                    (assignmentDetails?.allotedTimeMinutes || 0) * 60000,
                ).toISOString()
              : null,
        }}
        assignmentId={assignmentId}
      />
    </main>
  );
};

export default ClientLearnerLayout;
