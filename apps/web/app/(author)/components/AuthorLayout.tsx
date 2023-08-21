import DynamicTextBoxContainer from './DynamicTextBoxContainer';
import TextBox from "./textBox";


interface Props {}


function AuthorLayout(props: Props) {

  return (
    <div className="bg-white min-h-screen">
    <div className="bg-white flex flex-col min-h-screen">
      
      <div className="mt-0">
        <DynamicTextBoxContainer />
      </div>
      <div className="flex-grow">
        <TextBox />
      </div>
    </div>
    </div>
  );
}
export default AuthorLayout;