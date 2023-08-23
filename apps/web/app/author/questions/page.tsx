import DynamicTextBoxContainer from "../components/DynamicTextBoxContainer";
import TextBox from "../components/Textbox";

interface Props {}

function Component(props: Props) {
  const {} = props;

  return (
    <div>
      <div className="mt-0">
        <DynamicTextBoxContainer />
      </div>
      <TextBox />
    </div>
  );
}

export default Component;
