import { useLearnerStore } from "@/stores/learner";
import { useState } from "react";
import Button from "../Button";
import InfoLine from "../InfoLine";

interface Props {}

function UploadQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber
  );

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);
  const { question, id } = questions[activeQuestionNumber - 1];

  const [file, setFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  // Handles file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setFile(event.target.files[0]);
    }
  };

  // Handles the removal of uploaded file
  const handleFileRemoval = () => {
    setFile(null);
  };

  // Handles the form attempt
  const handleSubmit = () => {
    if (file) {
      setSubmitted(true);
      // updateStatus("edited");
      // if (onAnswerSelected) onAnswerSelected("pendingReview");
    }
  };

  return (
    <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
      <InfoLine text={question} />

      {/* File Upload Section */}
      <div className="mt-4 relative h-44 flex flex-col justify-center items-center border border-gray-300 rounded-md cursor-pointer">
        <input
          type="file"
          accept=".jpeg, .jpg, .png, .gif, .pdf"
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
        {file ? (
          <div className="flex items-center gap-2">
            {/* Displaying file icon */}
            <span className="material-icons text-gray-600">
              insert_drive_file
            </span>
            <span className="text-gray-600 text-sm font-medium">
              {file.name}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="bg-white rounded-md px-3 py-2 text-indigo-600 text-sm font-medium">
              Upload a file
            </button>
            <span className="text-gray-600 text-sm font-medium">
              or drag and drop
            </span>
          </div>
        )}
        <span className="text-center text-gray-500 text-xs mt-2">
          Supported types: PNG, JPG, GIF, PDF up to 10MB
        </span>
      </div>

      {/* Submit Button */}
      <div className="flex justify-center mt-4">
        <Button onClick={handleSubmit}>Submit Response</Button>
      </div>

      {submitted && (
        <p className="mt-2 text-sm text-gray-600">
          Your answer has been submitted and is pending review.
        </p>
      )}
    </div>
  );
}

export default UploadQuestion;
