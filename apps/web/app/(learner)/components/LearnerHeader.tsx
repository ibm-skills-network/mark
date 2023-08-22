import SNIcon from "../../SNIcon";
import Breadcrumbs from "./Breadcrumbs";
import Title from "./Title";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;

  return (
    <div className="border-2 border-gray-400 w-full p-4">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title text="Auto-Graded Assignment Creator" />
          <div>
            <Breadcrumbs />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LearnerHeader;
