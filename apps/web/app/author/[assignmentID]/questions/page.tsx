import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import TextBox from "@authorComponents/Textbox";

interface Props {}

function Component(props: Props) {
  const {} = props;

  return (
    <div>
      <DynamicTextBoxContainer />
      <TextBox />
    </div>
  );
}

export default Component;
