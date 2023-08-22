/**
 * LongFormQuestion Component Design Document
 *
 * Overview:
 * The LongFormQuestion component is designed to present long-form questions where users can type out their answers.
 * The component includes the question text, instructions, a text area for the user's response, and a maximum word count.
 *
 * Component Structure:
 * 1. Title: Displays the question's title and the points for the question.
 * 2. Instructions: Provides additional instructions for answering the question.
 * 3. Text Area: Allows users to input their answers.
 * 4. Word Count: Displays the maximum word count for the answer.
 * 5. Navigation Buttons: "Back to Instructions" and "Submit Question" buttons for navigation.
 *
 * Props:
 * - questionText (string): The text of the question to be displayed.
 * - instructions (string): Additional instructions or guidelines for the question.
 * - maxWords (number, optional): The maximum number of words allowed in the answer. Defaults to 800.
 * - points (number): Points allocated for the question.
 *
 * State:
 * - answer (string): Keeps track of the user's typed answer.
 *
 * Conclusion:
 * The LongFormQuestion component offers a straightforward way to present long-form questions, suitable for use in exams,
 * assignments, and various educational applications. It is designed for ease of integration with overview components
 * and provides flexibility for various use cases.
 */

"use client";

import MarkdownEditor from "@components/MarkDownEditor";
import React, { useState } from "react";
import Button from "./Button";
import Title from "./Title";

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
      className="bg-white p-8 rounded-lg shadow-md question-container"
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
