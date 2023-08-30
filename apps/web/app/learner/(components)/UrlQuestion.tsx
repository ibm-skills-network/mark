"use client";

import { Question } from "@/config/types";
import React, { useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  questionData?: Question;
  onURLSubmit?: (url: string) => void; // This callback is for when the URL is submitted
}

function URLQuestion(props: Props) {
  const { questionData, onURLSubmit } = props;
  const { question } = questionData;
  const [url, setURL] = useState<string>("");

  const handleURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setURL(e.target.value);
  };

  const handleSubmit = () => {
    if (validateURL(url)) {
      if (onURLSubmit) {
        onURLSubmit(url);
      }
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
        Submit URL
      </Button>
    </>
  );
}

export default URLQuestion;
