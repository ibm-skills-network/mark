import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Breadcrumbs from "./Breadcrumbs";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;

  return (
    <header className="border-2 border-gray-400 w-full p-4">
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
    </header>
  );
}

export default LearnerHeader;
