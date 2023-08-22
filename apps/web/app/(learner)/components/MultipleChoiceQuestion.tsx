/**
 * MultipleChoiceQuestion Component Design Document
 *
 * Overview:
 * The MultipleChoiceQuestion component is designed to present multiple-choice questions to users and collect their responses.
 * The component includes the question text, a list of answer options, a button to submit the answer, and feedback based on
 * the correctness of the user's choice. The component can handle single or multiple correct answers.
 *
 * Component Structure:
 * 1. Title: Displays the question's title and the current points.
 * 2. InfoLine: Displays the question text.
 * 3. Options: Displays all answer options as buttons.
 * 4. Submit Button: Allows the user to submit their selection.
 * 5. Feedback Message: Provides feedback based on the user's selection.
 * 6. Navigation Buttons: "Previous Question" and "Next Question" buttons for navigation.
 *
 * Props:
 * - questionText (string): The text of the question to be displayed.
 * - options (string[]): An array containing the text for all available options.
 * - correctOptions (string[]): An array containing the text for the correct options only.
 * - points (number): Unused in this code. Can be removed or adapted for other purposes.
 * - onAnswerSelected? (function): Optional callback function that receives the status of the user's answer ("correct", "incorrect", or "partiallyCorrect").
 *
 * State:
 * - selectedOptions (string[]): Keeps track of the options selected by the user.
 * - isCorrect ('all' | 'some' | 'none' | null): Status of the answer's correctness.
 * - pointsEarned (number): Calculated points based on the correct selections.
 * - submitted (boolean): Indicates if the question has been submitted.
 *
 * Functions:
 * - handleOptionClick: Handles the selection of options, toggling the selected state.
 * - handleSubmit: Evaluates the user's selection and provides feedback and points.
 * - renderFeedbackMessage: Renders the appropriate feedback message based on the user's selection.
 *
 * CSS Classes:
 * - text-green-600: Correct answer feedback.
 * - text-yellow-600: Partially correct answer feedback.
 * - text-red-600: Incorrect answer feedback.
 * - bg-green-100, bg-red-100, bg-blue-100: Background color for selected options.
 *
 * Conclusion:
 * The MultipleChoiceQuestion component offers a robust way to present multiple-choice questions to users and is suitable
 * for use in quizzes, surveys, and educational applications. With room for future enhancements and customization, it
 * provides a solid foundation for diverse use cases.
 */
"use client";
"use client";
"use client";

import Title from "@components/Title";
import React, { useEffect, useState } from "react";
import Button from "./Button";
import InfoLine from "./InfoLine";

interface Props {
  questionNumber: number;
  questionText: string;
  options: string[];
  correctOptions: string[];
  points: number;
  onAnswerSelected?: (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => void;
}

function MultipleChoiceQuestion(props: Props) {
  const {
    questionNumber,
    questionText,
    options,
    correctOptions,
    onAnswerSelected,
  } = props;
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isCorrect, setIsCorrect] = useState<"all" | "some" | "none" | null>(
    null
  );
  const [pointsEarned, setPointsEarned] = useState<number>(0);
  const [submitted, setSubmitted] = useState<boolean>(false);

  useEffect(() => {
    setSelectedOptions([]);
    setIsCorrect(null);
    setPointsEarned(0);
    setSubmitted(false);
  }, [questionNumber]);

  const handleOptionClick = (option: string) => {
    setSubmitted(false);
    const alreadySelected = selectedOptions.includes(option);
    const newSelectedOptions = alreadySelected
      ? selectedOptions.filter((opt) => opt !== option)
      : [...selectedOptions, option];

    setSelectedOptions(newSelectedOptions);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    let correctCount = 0;
    let incorrectCount = 0;

    selectedOptions.forEach((option) => {
      if (correctOptions.includes(option)) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const finalCorrectCount = Math.max(correctCount - incorrectCount, 0);
    const points = (finalCorrectCount / correctOptions.length) * 100;
    setPointsEarned(points);

    let status: "correct" | "incorrect" | "partiallyCorrect" = "incorrect";
    if (
      finalCorrectCount === correctOptions.length &&
      selectedOptions.length === correctOptions.length
    ) {
      status = "correct";
      setIsCorrect("all");
    } else if (finalCorrectCount > 0) {
      status = "partiallyCorrect";
      setIsCorrect("some");
    } else {
      setIsCorrect("none");
    }

    if (onAnswerSelected) {
      onAnswerSelected(status);
    }
  };

  const renderFeedbackMessage = () => {
    if (isCorrect === "all") {
      return <p className="text-green-600">Correct! Well done.</p>;
    }
    if (isCorrect === "some") {
      return (
        <p className="text-yellow-600">
          Not all correct answers were selected. Try again.
        </p>
      );
    }
    if (isCorrect === "none") {
      return (
        <p className="text-red-600">Incorrect choice. Please try again.</p>
      );
    }
    return null;
  };

  return (
    <div
      className="p-8 bg-white rounded-lg shadow-md question-container"
      style={{ height: "500px", overflowY: "auto" }}
    >
      <Title
        text={`Question ${questionNumber}: Points ${pointsEarned.toFixed(
          2
        )} out of 100`}
      />
      <InfoLine text={questionText} />
      <div className="mb-4">
        {options.map((option, index) => (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              submitted
                ? selectedOptions.includes(option)
                  ? correctOptions.includes(option)
                    ? "bg-green-100 text-black"
                    : "bg-red-100 text-black"
                  : "text-black"
                : selectedOptions.includes(option)
                ? "bg-blue-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleOptionClick(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <Button text="Submit" onClick={handleSubmit} />
      {renderFeedbackMessage()}
    </div>
  );
}

export default MultipleChoiceQuestion;
