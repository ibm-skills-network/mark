"use client";

import { useAssignmentDetails } from "@/stores/learner";
import { useEffect, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  name: string;
  allotedTimeMinutes?: number;
  timeEstimateMinutes?: number;
  numAttempts?: number;
  passingGrade?: number;
  assignmentId: number;
}

function Component(props: Props) {
  const {
    name,
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts,
    passingGrade,
    assignmentId,
  } = props;

  const setAssignmentDetails = useAssignmentDetails(
    (state) => state.setAssignmentDetails
  );

  useEffect(() => {
    setAssignmentDetails({
      name,
      allotedTimeMinutes,
      numAttempts,
      passingGrade,
      id: assignmentId,
    });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
        {name}
      </h1>
      <div className="mt-1 flex flex-row space-x-2 text-sm text-gray-500">
        <div className="flex items-center">
          Attempts Allowed: {numAttempts || "Unlimited"}
        </div>
        <div className="border-r border-gray-400 h-4 self-center"></div>
        <div className="flex items-center">
          {allotedTimeMinutes ? (
            <>Time Limit: {allotedTimeMinutes} minutes</>
          ) : (
            "No Time Limit"
          )}
        </div>
        <div className="border-r border-gray-400 h-4 self-center"></div>
        <div className="flex items-center">
          {timeEstimateMinutes ? (
            <>Time Estimate: {timeEstimateMinutes} minutes</>
          ) : (
            "No Time Estimate"
          )}
        </div>
        <div className="border-r border-gray-400 h-4 self-center"></div>
        <div className="flex items-center">
          {passingGrade ? (
            <>Passing Grade: {passingGrade}%</>
          ) : (
            "No Passing Grade"
          )}
        </div>
        {/* <div className="flex items-center">Out Of: {outOf}</div> */}
      </div>
    </div>
  );
}

export default Component;
