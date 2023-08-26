"use client";

import { Question } from "@/config/types";
import MarkdownEditor from "@components/MarkDownEditor";
import React, { useState } from "react";
import Button from "./Button";

interface Props {
  questionData?: Question;
  questionNumber: number;
}

function TextQuestion(props: Props) {
  const { questionData, questionNumber } = props;
  const { question, totalPoints } = questionData;
  const [answer, setAnswer] = useState<string>("");
  const maxWords = 1000;
  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <p className="mb-4 text-gray-700">{question}</p>
        <MarkdownEditor value={answer} setValue={setAnswer} />
        <p className="text-gray-600">Max {maxWords} words</p>
      </div>
      <div className="flex justify-center mt-4">
        <Button className=" ">Submit Question</Button>
      </div>
    </>
  );
}

export default TextQuestion;
