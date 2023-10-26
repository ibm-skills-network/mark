import Tooltip from "@/components/Tooltip";
import { Assignment, LearnerAssignmentState } from "@/config/types";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Button from "@learnerComponents/Button";
import Link from "next/link";
import { type ComponentPropsWithoutRef, type MouseEvent } from "react";
import AssignmentMainInfo from "./AssignmentMainInfo";

interface Props extends ComponentPropsWithoutRef<"div"> {
  assignment: Assignment;
  assignmentState: LearnerAssignmentState;
}

function AboutTheAssignment(props: Props) {
  const { assignment, assignmentState } = props;
  const {
    instructions,
    introduction,
    gradingCriteriaOverview,
    allotedTimeMinutes,
    numAttempts,
    passingGrade,
    name,
    id,
  } = assignment;

  function handleViewResults(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    console.log("view results");
  }

  return (
    <>
      <div className="flex justify-between items-center">
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
          <Button className="group flex gap-x-2" onClick={handleViewResults}>
            View Results
            <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
          </Button>
        ) : (
          // it's either "not-started" or "in-progress"
          <Tooltip
            className=""
            distance={3}
            disabled={assignmentState !== "not-published"}
            content="This assignment has not been published yet."
          >
            <Link href={`/learner/${id}/questions`}>
              <Button
                className="group flex gap-x-2"
                disabled={assignmentState === "not-published"}
              >
                {assignmentState === "in-progress" ? "Resume " : "Begin "}the
                Assignment
                <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
              </Button>
            </Link>
          </Tooltip>
        )}
      </div>
      <div className="border border-gray-300 rounded-lg bg-white p-4 flex flex-col gap-y-4">
        {introduction && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              About this Assignment
            </h3>
            <p className="text-gray-600">{introduction}</p>
          </>
        )}
        {instructions && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              Instructions
            </h3>
            <p className="text-gray-600">{instructions}</p>
          </>
        )}
        {gradingCriteriaOverview && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              Grading Criteria
            </h3>
            <p className="text-gray-600">{gradingCriteriaOverview}</p>
          </>
        )}
        {!introduction && !instructions && !gradingCriteriaOverview && (
          <p className="text-gray-600">
            No information has been provided for this assignment.
          </p>
        )}
      </div>
    </>
  );
}

export default AboutTheAssignment;
