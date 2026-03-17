import AuthorQuestionsPage from "@/app/author/(components)/AuthorQuestionsPage";

interface Props {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ defaultQuestionRetries: string }>;
}

async function Component(props: Props) {
  const { params, searchParams } = props;
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { defaultQuestionRetries } = resolvedSearchParams;
  return (
    <AuthorQuestionsPage
      assignmentId={~~resolvedParams.assignmentId}
      defaultQuestionRetries={~~defaultQuestionRetries}
    />
  );
}

export default Component;
