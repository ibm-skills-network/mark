import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import QuestionStartPage from "@authorComponents/QuestionStartPage";

interface Props {}

function Component(props: Props) {
  const {} = props;

  return (
    <div>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          zIndex: 9999,
        }}
      >
        <QuestionStartPage />
      </div>

      <div className="relative">
        <DynamicTextBoxContainer />
      </div>
    </div>
  );
}

export default Component;
