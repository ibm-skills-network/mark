import { getAssignment } from "@/lib/talkToBackend";
import AssignmentOverview from "../(components)/AssignmentOverview";

interface Props {
  params: { assignmentId: string };
}

async function IntroductionPage(props: Props) {
  const { params } = props;

  const assignment = await getAssignment(parseInt(params.assignmentId));
  console.log(assignment);

  return (
    <main className="p-24 rounded-lg shadow-md h-full">
      <AssignmentOverview
        assignment={assignment}
        assignmentId={params.assignmentId}
      />
    </main>
  );
}

export default IntroductionPage;
