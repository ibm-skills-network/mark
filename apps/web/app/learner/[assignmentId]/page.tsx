import AboutTheAssignment from "@learnerComponents/AboutTheAssignment";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

function Component(props: Props) {
  const { params } = props;
  const { assignmentId } = params;

  return <AboutTheAssignment assignmentId={~~assignmentId} />;
}

export default Component;
