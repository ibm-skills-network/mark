import { useLearnerStore } from "@/stores/learner";
import { useState } from "react";
import Button from "../Button";
import InfoLine from "../InfoLine";

interface Props {}

function URLQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber
  );

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);
  const { question, id } = questions[activeQuestionNumber - 1];
  const [url, setURL] = useState<string>("");

  const handleURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setURL(e.target.value);
  };

  const handleSubmit = () => {
    if (validateURL(url)) {
      // updateStatus("edited");
      // if (onURLSubmit) {
      //   onURLSubmit(url);
      // }
    } else {
      alert("Please enter a valid URL.");
    }
  };

  const validateURL = (str: string) => {
    const pattern = new RegExp(
      "^(https?:\\/\\/)?" + // protocol
        "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
        "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
        "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
        "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
        "(\\#[-a-z\\d_]*)?$",
      "i"
    ); // fragment locator
    return pattern.test(str);
  };

  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <InfoLine text={question} />
        <input
          type="text"
          placeholder="Enter website URL"
          value={url}
          onChange={handleURLChange}
          className="w-full p-2 mt-4 border rounded"
        />
      </div>
      <Button onClick={handleSubmit} disabled={!url}>
        Submit Question
      </Button>
    </>
  );
}

export default URLQuestion;
