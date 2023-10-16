import DynamicTextBoxContainer from "@authorComponents/DynamicTextBoxContainer";
import TextBox from "@authorComponents/Textbox";
import { useRouter } from "next/router";

interface Props {
  params: { assignmentId: string };
  searchParams: { defaultQuestionRetries: string; submissionTime?: string };
}

function Component(props: Props) {
  const { params, searchParams } = props;
  const { submissionTime, defaultQuestionRetries } = searchParams;
  console.log("submissionTime", submissionTime);
  console.log("difference", Date.now() - ~~submissionTime);
  console.log("is within", Date.now() - ~~submissionTime < 10000);

  return (
    <div className="overflow-auto">
      {/* if submission tims is within 10 seconds of now, show the submitted page */}
      {~~submissionTime && Date.now() - ~~submissionTime < 10000 ? (
        <div className="flex items-center justify-center p-4 bg-yellow-100 border-l-4 border-yellow-500">
          <div className="flex items-center justify-center w-6 h-6 mr-2 bg-yellow-500 rounded-full">
            {/* <ExclamationCircleIcon className="w-4 h-4 text-white" /> */}
          </div>
          <div className="text-sm text-yellow-700">
            This assignment has been submitted. You can no longer make changes.
          </div>
        </div>
      ) : (
        <DynamicTextBoxContainer
          assignmentId={~~params.assignmentId}
          defaultQuestionRetries={~~defaultQuestionRetries}
        />
      )}
    </div>
  );
}

export default Component;
