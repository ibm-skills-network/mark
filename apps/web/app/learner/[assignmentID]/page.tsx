import { getAssignment } from "@/lib/talkToBackend";
import Button from "@learnerComponents/Button";
import Link from "next/link";

interface Props {
  params: { assignmentID: string };
}

async function IntroductionPage(props: Props) {
  const { params } = props;
  const outOf = 40;

  const { instructions, introduction, allotedTime, numAttempts, name } =
    await getAssignment(parseInt(params.assignmentID));

  return (
    <main className="p-24 rounded-lg shadow-md h-full">
      <div className="border-2 p-4 flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            {name}
          </h1>
          <div className="mt-1 flex flex-row space-x-2 text-sm text-gray-500">
            <div className="flex items-center">
              Attempts Allowed: {numAttempts}
            </div>
            <div className="border-r border-gray-400 h-4 self-center"></div>
            <div className="flex items-center">
              Time Limit: {allotedTime} minutes
            </div>
            <div className="border-r border-gray-400 h-4 self-center"></div>
            <div className="flex items-center">Out Of: {outOf}</div>
          </div>
        </div>
        <Link href={`/learner/${params.assignmentID}/questions`}>
          <Button>Begin the Assignment {">"}</Button>
        </Link>
      </div>
      <div className="border-2 border-gray-400 bg-white p-4">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          About this Assignment
        </h3>
        <p className="text-gray-600 mb-4">{introduction}</p>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Instructions
        </h3>
        <p className="text-gray-600 mb-4">{instructions}</p>
      </div>
    </main>
  );
}

export default IntroductionPage;
