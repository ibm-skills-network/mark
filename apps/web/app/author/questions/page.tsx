import DynamicTextBoxContainer from "../(components)/DynamicTextBoxContainer";
import TextBox from "../(components)/Textbox";

interface Props {}

function Component(props: Props) {
  const {} = props;

  return (
    <div>
      <TextBox />
      <div className="mt-0">
        <DynamicTextBoxContainer />
      </div>
    </div>
  );
}

export default Component;
