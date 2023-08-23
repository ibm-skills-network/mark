"use client";

import MarkdownEditor from "@components/MarkDownEditor";
import Title from "@components/Title";
import React, { useState } from "react";
import Button from "./Button";

interface Props {
  questionText: string;
  instructions: string;
  maxWords?: number;
  points: number;
  questionNumber: number;
}

function LongFormQuestion(props: Props) {
  const {
    questionText,
    instructions,
    maxWords = 800,
    points,
    questionNumber,
  } = props;
  const [answer, setAnswer] = useState<string>("");
  
  return (
    <div
      className="p-8 rounded-lg shadow-md question-container"
      style={{ height: "500px", overflowY: "auto" }}
    >
      <Title
        text={`Question ${questionNumber}: Points out of ${points} (${
          (points / 40) * 100
        }%)`}
      />
      <p className="mb-4 text-gray-700">{questionText}</p>
      <p className="mb-4 text-gray-700">{instructions}</p>
      <MarkdownEditor value={answer} onChange={setAnswer} />
      <p className="text-gray-600">Max {maxWords} words</p>
      <div className="flex justify-between mt-4">
        <Button text="Submit Question" />
      </div>
    </div>
  );
}

export default LongFormQuestion;
