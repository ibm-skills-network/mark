import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Breadcrumbs from "./Breadcrumbs";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title
            text="Auto-Graded Assignment Creator"
            className="text-lg font-semibold"
          />
          <div>
            <Breadcrumbs />
          </div>
        </div>
      </div>
    </header>
  );
}

export default LearnerHeader;
