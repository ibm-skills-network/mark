import PageTitle from "../(components)/PageTitle";
import { FooterNavigation } from "../(components)/StepOne/FooterNavigation";
import MainContent from "../(components)/StepOne/MainContent";
import SuccessPage from "../(components)/SuccessPage";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  const { submissionTime } = searchParams;
  const { assignmentId } = params;
  return (
    <main className="main-author-container">
      {/* if submission tims is within 10 seconds of now, show the submitted page, and it can't be greater than the current date in this page */}
      {submissionTime ? (
        <SuccessPage />
      ) : (
        <>
          <PageTitle
            title="Let's set up your assignment!"
            description="Responses in this section will be shown to learners."
          />
          <MainContent />
          <FooterNavigation assignmentId={String(assignmentId)} />
        </>
      )}
    </main>
  );
}

export default Component;
