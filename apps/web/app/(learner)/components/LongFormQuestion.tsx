"use client";

import React, { useState } from "react";
import Button from "./Button";
import Title from "./Title";

interface Props {
  questionText: string;
  instructions: string;
  maxWords?: number;
  points: number;
}

function LongFormQuestion(props: Props) {
  const { questionText, instructions, maxWords = 800, points } = props;
  const [answer, setAnswer] = useState("");

  return (
    <div className="bg-white p-8 rounded-lg shadow-md question-container">
      <Title
        text={`Question 1: Points out of ${points} (${(points / 40) * 100}%)`}
      />
      <p className="mb-4 text-gray-700">{questionText}</p>
      <Title text="Start writing your answer here." level="3" />
      <textarea
        className="w-full p-2 mb-4 border rounded text-black"
        placeholder="Type your answer here..."
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <p className="text-gray-600">Max {maxWords} words</p>
      <div className="flex justify-between mt-4">
        <Button text="Back to Instructions" />
        <Button text="Submit Question" />
      </div>
    </div>
  );
}

export default LongFormQuestion;
