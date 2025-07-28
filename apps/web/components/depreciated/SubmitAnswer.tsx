import { submitFileAnswer, submitTextOrURLAnswer } from "@/lib/talkToBackend";
import { useState, type FC } from "react";

interface Props {
  assignmentId: number;
  attemptId: number;
  questionId: number;
  questionType: string;
}

const SubmitAnswerComponent: FC<Props> = ({
  assignmentId,
  attemptId,
  questionId,
  questionType,
}) => {
  const [answer, setAnswer] = useState<string | File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);

  const handleSubmit = async () => {
    setIsLoading(true);

    let responseBody = {};

    switch (questionType) {
      case "TEXT":
        responseBody = { learnerTextResponse: answer };
        break;
      case "URL":
        responseBody = { learnerUrlResponse: answer };
        break;
      default:
        break;
    }

    try {
      if (questionType === "UPLOAD" && answer instanceof File) {
        const isSuccess = await submitFileAnswer(
          assignmentId,
          attemptId,
          questionId,
          answer,
        );
        setSuccess(isSuccess);
      } else {
        const isSuccess = await submitTextOrURLAnswer(
          assignmentId,
          attemptId,
          questionId,
          responseBody,
        );
        setSuccess(isSuccess);
      }
    } catch (error) {
      setSuccess(false);
    } finally {
      setIsLoading(false);
    }
  };

  const renderInputField = () => {
    switch (questionType) {
      case "TEXT":
        return (
          <textarea
            value={answer as string}
            onChange={(e) => setAnswer(e.target.value)}
          />
        );
      case "URL":
        return (
          <input
            type="url"
            value={answer as string}
            onChange={(e) => setAnswer(e.target.value)}
          />
        );
      case "UPLOAD":
        return (
          <input
            type="file"
            onChange={(e) =>
              setAnswer(e.target.files ? e.target.files[0] : null)
            }
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      {renderInputField()}
      <button onClick={handleSubmit} disabled={isLoading || !answer}>
        Submit
      </button>
      {isLoading && <p>Submitting...</p>}
      {success === true && <p>Answer submitted successfully!</p>}
      {success === false && <p>Failed to submit answer. Please try again.</p>}
    </div>
  );
};

export default SubmitAnswerComponent;
