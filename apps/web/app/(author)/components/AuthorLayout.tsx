import DynamicTextBoxContainer from './DynamicTextBoxContainer';
import TextBox from "./TextBox";


interface Props {}


function AuthorLayout(props: Props) {

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <div className="flex-grow">
        <TextBox />
      </div>
      <div className="mt-auto">
        <DynamicTextBoxContainer />
      </div>
    </div>
  );
}
export default AuthorLayout;