import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import TextBox from "@authorComponents/Textbox";

interface Props {
  params: { assignmentId: string };
}

function Component(props: Props) {
  const { params } = props;

  return (
    <div className="">
      <DynamicTextBoxContainer assignmentId={~~params.assignmentId} />
    </div>
  );
}

export default Component;
