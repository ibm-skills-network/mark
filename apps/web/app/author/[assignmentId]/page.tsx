import dynamic from "next/dynamic";
import PageTitle from "../(components)/PageTitle";
import { FooterNavigation } from "../(components)/StepOne/FooterNavigation";
import MainContent from "../(components)/StepOne/MainContent";

const DynamicSuccessPage = dynamic(
  () => import("../(components)/SuccessPage"),
  { ssr: false },
);

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
      {submissionTime ? (
        <DynamicSuccessPage />
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
