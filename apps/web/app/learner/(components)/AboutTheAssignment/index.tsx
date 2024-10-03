import ErrorPage from "@/components/ErrorPage";
import MarkdownViewer from "@/components/MarkdownViewer";
import Tooltip from "@/components/Tooltip";
import { LearnerAssignmentState } from "@/config/types";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { headers } from "next/headers";
import { type ComponentPropsWithoutRef, type MouseEvent } from "react";
import AssignmentMainInfo from "./AssignmentMainInfo";
import BeginTheAssignmentButton from "./BeginTheAssignmentButton";

interface Props extends ComponentPropsWithoutRef<"div"> {
  assignmentId: number;
}

async function AboutTheAssignment(props: Props) {
  const { assignmentId } = props;
  const headerList = headers();
  const cookie = headerList.get("cookie");
  const assignment = await getAssignment(assignmentId, cookie);
  // go to the error page if the assignment is not found
  if (!assignment) {
    return (
      <ErrorPage
        className="h-[calc(100vh-85px)]"
        error={"Assignment not found"}
      />
    );
  }
  const listOfAttempts = await getAttempts(assignmentId, cookie);
  // if the number of attempts of the assignment is equals to the assignment's max attempts, then the assignment state is "completed"
  let assignmentState: LearnerAssignmentState = "not-started";
  if (listOfAttempts?.length === assignment.numAttempts) {
    assignmentState = "completed";
  } else {
    // check if there are any attempts that are not submitted and have not expired
    const unsubmittedAssignment = listOfAttempts?.find(
      (attempt) =>
        attempt.submitted === false &&
        // if the assignment does not expire, then the expiresAt is null
        (attempt.expiresAt === null ||
          Date.now() < Date.parse(attempt.expiresAt)),
    );
    if (unsubmittedAssignment) {
      assignmentState = "in-progress";
    }
  }
  const {
    instructions,
    introduction,
    published,
    gradingCriteriaOverview,
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts,
    passingGrade,
    name,
    id,
  } = assignment;

  if (!published) {
    assignmentState = "not-published";
  }

  return (
    <main className="p-20 flex flex-col gap-y-14 bg-gray-50 flex-1">
      <div className="flex justify-between items-center">
        {/* data passed here will also be stored in zustand store (possible to do that there because it's client-side rendered) */}
        <AssignmentMainInfo
          allotedTimeMinutes={allotedTimeMinutes}
          timeEstimateMinutes={timeEstimateMinutes}
          numAttempts={numAttempts}
          passingGrade={passingGrade}
          name={name}
          assignmentId={id}
        />
        <BeginTheAssignmentButton
          assignmentState={assignmentState}
          assignmentId={id}
        />
        {/* )} */}
      </div>
      <div className="border border-gray-300 rounded-lg bg-white p-4 flex flex-col gap-y-4">
        {introduction && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              About this Assignment
            </h3>
            <MarkdownViewer className="text-gray-600">
              {introduction}
            </MarkdownViewer>
          </>
        )}
        {instructions && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              Instructions
            </h3>
            <MarkdownViewer className="text-gray-600">
              {instructions}
            </MarkdownViewer>
          </>
        )}
        {gradingCriteriaOverview && (
          <>
            <h3 className="text-xl font-semibold text-gray-800">
              Grading Criteria
            </h3>
            <MarkdownViewer className="text-gray-600">
              {gradingCriteriaOverview}
            </MarkdownViewer>
          </>
        )}
        {!introduction && !instructions && !gradingCriteriaOverview && (
          <MarkdownViewer className="text-gray-600">
            No information has been provided for this assignment.
          </MarkdownViewer>
        )}
      </div>
      <BeginTheAssignmentButton
        className="flex justify-center"
        assignmentState={assignmentState}
        assignmentId={id}
      />
    </main>
  );
}

export default AboutTheAssignment;
