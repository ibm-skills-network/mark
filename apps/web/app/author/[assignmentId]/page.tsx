"use client";

import AssignmentForm from "../(components)/AssignmentForm";
import SuccessPage from "../(components)/SuccessPage";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  const { submissionTime } = searchParams;
  const { assignmentId } = params;
  // DON'T USE ~~ TO CONVERT TO INT, CAUSES THE NUMBER TO BECOME SMALLER THAN IT SHOULD BE
  const submissionTimeInt = parseInt(submissionTime);
  console.log("submissionTime", submissionTimeInt);
  console.log("date now", Date.now());
  console.log("difference", Date.now() - submissionTimeInt);
  console.log("is within", Date.now() - submissionTimeInt < 10000);
  const currentDateInThisPage = Date.now();

  return (
    <main className="flex flex-col gap-y-11 mx-auto max-w-6xl py-20">
      {/* if submission tims is within 10 seconds of now, show the submitted page, and it can't be greater than the current date in this page */}
      {submissionTime &&
      currentDateInThisPage - submissionTimeInt < 10000000 &&
      currentDateInThisPage > submissionTimeInt ? (
        <SuccessPage />
      ) : (
        <AssignmentForm assignmentId={~~assignmentId} />
      )}
    </main>
  );
}

export default Component;
