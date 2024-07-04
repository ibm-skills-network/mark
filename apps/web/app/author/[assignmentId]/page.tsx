import AssignmentForm from "../(components)/AssignmentDetailsForm";
import SuccessPage from "../(components)/SuccessPage";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  const { submissionTime } = searchParams;
  const { assignmentId } = params;
  const submissionTimeInt = submissionTime ? parseInt(submissionTime) : null;
  const currentDateInThisPage = Date.now();

  return (
    <main className="main-author-container">
      {/* if submission tims is within 10 seconds of now, show the submitted page, and it can't be greater than the current date in this page */}
      {submissionTime &&
      currentDateInThisPage - submissionTimeInt < 10000 &&
      currentDateInThisPage > submissionTimeInt ? (
        <SuccessPage />
      ) : (
        <AssignmentForm assignmentId={~~assignmentId} />
      )}
    </main>
  );
}

export default Component;
