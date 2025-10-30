import { QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import { useLearnerStore } from "@/stores/learner";
import { useState, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  question: QuestionStore;
  onUrlChange: (url: string, questionId: number) => void;
}

function URLQuestion(props: Props) {
  const { className, question, onUrlChange } = props;
  const [setURLResponse] = useLearnerStore((state) => [state.setURLResponse]);
  const { id, learnerUrlResponse: url } = question;
  const [validURL, setValidURL] = useState<boolean>(true);

  const handleURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setURLResponse(newUrl, id);
    setValidURL(newUrl ? validateURL(newUrl) : true);
    onUrlChange(newUrl, id);
  };

  const validateURL = (str: string) => {
    const pattern = new RegExp(
      "^(https?:\\/\\/)?" +
        "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" +
        "((\\d{1,3}\\.){3}\\d{1,3}))" +
        "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" +
        "(\\?[;&a-z\\d%_.~+=-]*)?" +
        "(\\#[-a-z\\d_]*)?$",
      "i",
    );
    return pattern.test(str);
  };

  const showError = url && !validURL;

  return (
    <div className="relative">
      <input
        type="text"
        className={cn(
          "w-full p-2 border rounded",
          !validURL ? "border-red-500" : "border-gray-300",
          className,
        )}
        value={url}
        placeholder="Enter website URL"
        onChange={handleURLChange}
      />

      {showError && (
        <div className="absolute top-full left-0 mt-1 z-10 bg-red-50 border border-red-200 rounded-md shadow-lg p-3 min-w-max">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">!</span>
            </div>
            <span className="text-red-700 text-sm">
              The link you sent doesn't seem right, please double check
            </span>
          </div>
          <div className="absolute -top-1 left-4 w-2 h-2 bg-red-50 border-l border-t border-red-200 transform rotate-45"></div>
        </div>
      )}
    </div>
  );
}

export default URLQuestion;
