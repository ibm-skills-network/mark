import PageTitle from "../(components)/PageTitle";
import SuccessPage from "../(components)/SuccessPage";
import { FooterNavigation } from "../(components)/StepOne/FooterNavigation";
import MainContent from "../(components)/StepOne/MainContent";

interface Props {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ submissionTime?: string }>;
}

async function Component(props: Props) {
  const { params, searchParams } = props;
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { submissionTime } = resolvedSearchParams;
  const { assignmentId } = resolvedParams;

  return (
    <main className="main-author-container">
      {submissionTime ? (
        <SuccessPage />
      ) : (
        <>
          <PageTitle
            title="Assignment Overview"
            description="Basic details shown to learners when they open the assignment."
          />

          <MainContent />
          <FooterNavigation
            assignmentId={String(assignmentId)}
            nextStep="questions"
          />
        </>
      )}
    </main>
  );
}

export default Component;
