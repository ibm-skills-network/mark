import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import TextBox from "@authorComponents/Textbox";
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
      <DynamicTextBoxContainer
        assignmentId={~~params.assignmentId}
        defaultQuestionRetries={~~defaultQuestionRetries}
      />
    </div>
  );
}

export default Component;
