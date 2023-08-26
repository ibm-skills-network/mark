"use client";

import { Question } from "@/config/types";
import MarkdownEditor from "@components/MarkDownEditor";
import React, { useState } from "react";
import Button from "./Button";

interface Props {
  questionData?: Question;
  questionNumber: number;
}

function LongFormQuestion(props: Props) {
  const { questionData, questionNumber } = props;
  const { question, totalPoints } = questionData;
  const [answer, setAnswer] = useState<string>("");
  const maxWords = 1000;
  return (
    <div
      className="p-8 question-container"
      style={{ height: "500px", overflowY: "auto" }}
    >
      <p>
        Question {questionNumber}: Points {totalPoints.toFixed(2)} out of 100
      </p>
      <div className="mb-4 bg-white p-5">
        <p className="mb-4 text-gray-700">{question}</p>
        <MarkdownEditor value={answer} setValue={setAnswer} />
        <p className="text-gray-600">Max {maxWords} words</p>
      </div>
      <div className="flex justify-between mt-4">
        <Button>Submit Question</Button>
      </div>
    </div>
  );
}

export default LongFormQuestion;
