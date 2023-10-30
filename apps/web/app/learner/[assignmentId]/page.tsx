import AboutTheAssignment from "@learnerComponents/AboutTheAssignment";
import SuccessPage from "@learnerComponents/SuccessPage";

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
  const currentDateInThisPage = Date.now();

  return (
    <>
      {/* if submission tims is within 10 seconds of now, show the submitted page, and it can't be greater than the current date in this page */}
      {submissionTime &&
      currentDateInThisPage - submissionTimeInt < 10000000 &&
      currentDateInThisPage > submissionTimeInt ? (
        <SuccessPage />
      ) : (
        <AboutTheAssignment assignmentId={~~assignmentId} />
      )}
    </>
  );
}

export default Component;
