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
            title="Let's set up your assignment!"
            description="Responses in this section will be shown to learners."
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
