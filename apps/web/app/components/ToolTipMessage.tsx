import { FC } from "react";

interface TooltipMessageProps {
  isLoading: boolean;
  questionsLength: number | undefined;
  hasEmptyQuestion: boolean;
  isValid: boolean;
  message: string;
  submitting: boolean;
  hasChanges: boolean;
  changesSummary: string;
  invalidQuestionId: number;
  onNavigate: () => void;
}

const TooltipMessage: FC<TooltipMessageProps> = ({
  isLoading,
  questionsLength,
  hasEmptyQuestion,
  isValid,
  message,
  submitting,
  hasChanges,
  changesSummary,
  invalidQuestionId,
  onNavigate,
}) => {
  if (isLoading) return "Loading questions...";
  if (questionsLength === 0) return "You need to add at least one question";
  if (hasEmptyQuestion) return "Some questions have incomplete fields";
  if (!isValid)
    return (
      <>
        <span>{message}</span>
        {!isValid && (
          <button
            onClick={onNavigate}
            className="ml-2 text-blue-500 hover:underline"
          >
            Take me there
          </button>
        )}
      </>
    );
  if (submitting) return "Mark is analyzing your questions...";
  if (!hasChanges) return "No changes detected.";

  return (
    <>
      <span>Click to save and publish your changes.</span>
      <span className="block mt-2 text-sm font-normal text-gray-500">
        {changesSummary}
      </span>
    </>
  );
};

export default TooltipMessage;
