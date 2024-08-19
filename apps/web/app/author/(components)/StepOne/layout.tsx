import PageTitle from "../PageTitle";
import MainContent from "./MainContent";
import { FooterNavigation } from "./FooterNavigation";

interface Props {
  assignmentId: number;
}

const StepOne = (props: Props) => {
  const { assignmentId } = props;
  return (
    <>
      <PageTitle
        title="Let's set up your assignment!"
        description="Responses in this section will be shown to learners."
      />
      <MainContent />
      <FooterNavigation assignmentId={String(assignmentId)} />
    </>
  );
};

export default StepOne;
