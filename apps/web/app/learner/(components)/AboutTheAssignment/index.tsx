import { Assignment, LearnerAssignmentState } from "@/config/types";
import Button from "@learnerComponents/Button";
import Link from "next/link";
import { type ComponentPropsWithoutRef } from "react";
import AssignmentMainInfo from "./AssignmentMainInfo";

interface Props extends ComponentPropsWithoutRef<"div"> {
  assignment: Assignment;
  assignmentState: LearnerAssignmentState;
}

function AssignmentOverview(props: Props) {
  const { assignment, assignmentState } = props;
  const {
    instructions,
    introduction,
    allotedTimeMinutes,
    numAttempts,
    passingGrade,
    name,
    id,
  } = assignment;

  return (
    <>
      <div className="border-2 p-4 flex justify-between items-center mb-4">
        {/* data passed here will also be stored in zustand store (possible to do that there because it's client-side rendered) */}
        <AssignmentMainInfo
          allotedTimeMinutes={allotedTimeMinutes}
          numAttempts={numAttempts}
          passingGrade={passingGrade}
          name={name}
          assignmentId={id}
        />
        {/* if the assignment is completed, then show the "View Results" button */}
        {assignmentState === "completed" ? (
          <Link href={`/learner/${id}/results`}>
            <Button>View Results {">"}</Button>
          </Link>
        ) : (
          // it's either "not-started" or "in-progress"
          <Link href={`/learner/${id}/questions`}>
            <Button>
              {assignmentState === "in-progress" ? "Resume " : "Begin "}the
              Assignment
            </Button>
          </Link>
        )}
      </div>
      <div className="border-2 border-gray-400 bg-white p-4">
        {introduction && (
          <>
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              About this Assignment
            </h3>
            <p className="text-gray-600 mb-4">{introduction}</p>
          </>
        )}
        {instructions && (
          <>
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Instructions
            </h3>
            <p className="text-gray-600 mb-4">{instructions}</p>
          </>
        )}
        {!introduction && !instructions && (
          <p className="text-gray-600 mb-4">
            No instructions or introduction provided for this assignment.
          </p>
        )}
      </div>
    </>
  );
}

export default AssignmentOverview;
