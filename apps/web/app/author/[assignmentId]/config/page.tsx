import PageTitle from "@authorComponents/PageTitle";
import AssignmentType from "@/app/author/(components)/StepTwo/AssignmentType";
import AssignmentQuestionOrder from "@/app/author/(components)/StepTwo/AssignmentQuestionOrder";
import AssignmentTime from "@authorComponents/StepTwo/AssignmentTime";
import AssignmentCompletion from "@authorComponents/StepTwo/AssignmentCompletion";
import AssignmentFeedback from "@authorComponents/StepTwo/AssignmentFeedback";
import { FooterNavigation } from "@authorComponents/StepTwo/FooterNavigation";
interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  return (
    <main className="main-author-container">
      <PageTitle
        title="Let's configure your assignment settings!"
        description="Set up the assignment parameters. You can review and edit these later"
      />
      <AssignmentType />
      <AssignmentTime />
      <AssignmentCompletion />
      <AssignmentFeedback />
      <AssignmentQuestionOrder />
      <FooterNavigation />
    </main>
    // </div>
  );
}

export default Component;
