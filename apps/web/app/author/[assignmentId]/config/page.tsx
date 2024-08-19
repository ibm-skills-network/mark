import PageTitle from "@authorComponents/PageTitle";
import AssignmentType from "@/app/author/(components)/StepTwo/AssignmentType";
import AssignmentQuestionOrder from "@/app/author/(components)/StepTwo/AssignmentQuestionOrder";
import AssignmentTime from "@authorComponents/StepTwo/AssignmentTime";
import AssignmentCompletion from "@authorComponents/StepTwo/AssignmentCompletion";
import AssignmentFeedback from "@authorComponents/StepTwo/AssignmentFeedback";
import { FooterNavigation } from "@authorComponents/StepTwo/FooterNavigation";
import { getAssignment } from "@/lib/talkToBackend";
import ErrorPage from "@/components/ErrorPage";
// const Button: FC<ButtonProps> = ({ children, primary }) => (
// 	<button
// 		className={`justify-center px-4 py-2 ${
// 			primary
// 				? "text-white bg-violet-600 border-violet-600"
// 				: "text-violet-800 bg-violet-50 border-violet-100"
// 		} rounded-md border border-solid shadow-sm`}
// 	>
// 		{children}
// 	</button>
// );

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

export const stepTwoSections = {
  type: {
    title: "1. What type of assignment is this?",
    required: true,
  },
  time: {
    title: "2. How much time will learners have to complete this assignment?",
    required: false,
  },
  completion: {
    title: "3. How will learners complete the assignment?",
    required: true,
  },
  feedback: {
    title: "4. How much feedback should I give students?",
    description: "Choose what feedback Mark gives to students",
    required: true,
  },
  order: {
    title: "5. What order should questions appear in?",
    required: true,
  },
} as const;

function Component(props: Props) {
  const { params, searchParams } = props;
  console.log(params, searchParams);
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
