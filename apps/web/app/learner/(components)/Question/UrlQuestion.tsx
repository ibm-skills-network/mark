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
      "^(https?:\\/\\/)?" + // protocol
        "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
        "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
        "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
        "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
        "(\\#[-a-z\\d_]*)?$",
      "i",
    ); // fragment locator
    return pattern.test(str);
  };

  return (
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
  );
}

export default URLQuestion;
