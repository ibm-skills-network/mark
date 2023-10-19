import AuthorQuestionsPage from "@/app/author/(components)/AuthorQuestionsPage";
import TextBox from "@/app/author/(components)/QuestionWrapper";
import { useRouter } from "next/router";

interface Props {
  params: { assignmentId: string };
  searchParams: { defaultQuestionRetries: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  const { defaultQuestionRetries } = searchParams;
  return (
    <div className="overflow-auto">
      <AuthorQuestionsPage
        assignmentId={~~params.assignmentId}
        defaultQuestionRetries={~~defaultQuestionRetries}
      />
    </div>
  );
}

export default Component;
