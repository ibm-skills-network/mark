"use client";

import { Question, QuestionResponse, QuestionStatus } from "@/config/types";
import MarkdownEditor from "@components/MarkDownEditor";
import React, { useState } from "react";
import Button from "./Button";

interface Props {
  questionData?: Question;
  questionNumber: number;
  updateStatus: (status: QuestionStatus) => void;
}

function TextQuestion(props: Props) {
  const [submitted, setSubmitted] = useState<boolean>(false);
  const { questionData, questionNumber } = props;
  const { question, totalPoints } = questionData;
  const [answer, setAnswer] = useState<string>("");
  const handleSubmit = () => {
    setSubmitted(true);
    props.updateStatus("answered");
  };
  const maxWords = 5;
  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <p className="mb-4 text-gray-700">{question}</p>
        <MarkdownEditor
          value={answer}
          setValue={setAnswer}
          maxWords={maxWords}
        />
      </div>
      <div className="flex justify-center mt-4">
        <Button className=" " onClick={handleSubmit}>
          Submit Question
        </Button>
      </div>
    </>
  );
}

export default TextQuestion;
