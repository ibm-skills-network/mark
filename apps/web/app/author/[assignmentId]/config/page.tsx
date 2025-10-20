import AssignmentQuestionOrder from "@/app/author/(components)/StepTwo/AssignmentQuestionOrder";
import AssignmentType from "@/app/author/(components)/StepTwo/AssignmentType";
import PageTitle from "@authorComponents/PageTitle";
import AssignmentCompletion from "@authorComponents/StepTwo/AssignmentCompletion";
import AssignmentRetakeAttempts from "@authorComponents/StepTwo/AssignmentRetakeAttempts";
import AssignmentFeedback from "@authorComponents/StepTwo/AssignmentFeedback";
import AssignmentTime from "@authorComponents/StepTwo/AssignmentTime";
import { FooterNavigation } from "@authorComponents/StepTwo/FooterNavigation";
import AssignmentQuestionDisplay from "../../(components)/StepTwo/AssignmentQuestionDisplay";

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
      <AssignmentRetakeAttempts />
      <AssignmentFeedback />
      <AssignmentQuestionDisplay />
      <AssignmentQuestionOrder />
      <FooterNavigation />
    </main>
  );
}

export default Component;
