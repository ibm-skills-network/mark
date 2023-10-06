import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import TextBox from "@authorComponents/Textbox";

interface Props {
  params: { assignmentId: string };
  searchParams: { defaultQuestionRetries: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;

  return (
    <div className="">
      <DynamicTextBoxContainer
        assignmentId={~~params.assignmentId}
        defaultQuestionRetries={~~searchParams.defaultQuestionRetries}
      />
    </div>
  );
}

export default Component;
