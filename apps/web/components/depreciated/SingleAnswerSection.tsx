"use client";

import { useState } from "react";

interface SingleAnswerSectionProps {
  choicesSingleCorrect: any;
  selectedChoiceSingleCorrect: any;
  handleChoiceToggleSingleCorrect: any;
  handleChoiceChangeSingleCorrect: any;
  setChoicesSingleCorrect: any;
}

function SingleAnswerSection(props: SingleAnswerSectionProps) {
  const {
    choicesSingleCorrect,
    selectedChoiceSingleCorrect,
    handleChoiceToggleSingleCorrect,
    handleChoiceChangeSingleCorrect,
    setChoicesSingleCorrect,
  } = props;

  const [points, setPoints] = useState(
    Array(choicesSingleCorrect.length).fill(0),
  );

  const handlePointsChange = (index, value) => {
    const intValue = ~~value;

    if (Number.isInteger(intValue) && intValue >= 0) {
      const updatedPoints = [...points];
      updatedPoints[index] = intValue;
      setPoints(updatedPoints);
    }
  };
  const [showPointsInput, setShowPointsInput] = useState(
    Array(choicesSingleCorrect.length).fill(false),
  );

  const handleShowPointsInputChange = (index, value) => {
    setShowPointsInput((prevState) => {
      const updatedState = [...prevState];
      updatedState[index] = value;
      return updatedState;
    });
  };

  return (
    <div className="mt-4">
      <p>Choices:</p>
      {choicesSingleCorrect.map((choice, index) => (
        <div key={index} className="flex items-center mb-[5px]">
          <input
            type="radio"
            name="singleCorrectChoice"
            value={choice}
            checked={choice === selectedChoiceSingleCorrect}
            onChange={() => handleChoiceToggleSingleCorrect(index)}
            className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600"
          />

          <div className="ml-2"> {String.fromCharCode(65 + index)}.</div>

          <textarea
            className="w-[800px] p-2 border-transparent mb-[10px] rounded-md text-black bg-transparent outline-none"
            placeholder={`Choice ${index + 1}`}
            value={choice}
            onChange={(event) =>
              handleChoiceChangeSingleCorrect(index, event.target.value)
            }
            style={{
              height: "2.0rem",
              maxWidth: "100%",
              overflow: "hidden",
              resize: "vertical",
            }}
          />

          <button
            className="ml-2 text-red-600"
            onClick={() => {
              const updatedChoices = [...choicesSingleCorrect];
              updatedChoices.splice(index, 1);
              setChoicesSingleCorrect(updatedChoices);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
              />
            </svg>
          </button>
          {showPointsInput[index] ? (
            <input
              type="number"
              value={points[index]}
              onChange={(event) =>
                handlePointsChange(index, event.target.value)
              }
              className="ml-2 w-20"
              onBlur={() => handleShowPointsInputChange(index, false)}
            />
          ) : (
            <button
              disabled={choice !== selectedChoiceSingleCorrect}
              onClick={() => handleShowPointsInputChange(index, true)}
            >
              {points[index] === undefined ? 0 : points[index]} points
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="rounded-full w-[160px] bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-200"
        onClick={() => setChoicesSingleCorrect([...choicesSingleCorrect, ""])}
      >
        <div className="flex items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="21"
            viewBox="0 0 20 21"
            fill="none"
          >
            <path
              d="M11.3438 7.34375C11.3438 7.11997 11.2549 6.90536 11.0966 6.74713C10.9384 6.58889 10.7238 6.5 10.5 6.5C10.2762 6.5 10.0616 6.58889 9.90338 6.74713C9.74515 6.90536 9.65625 7.11997 9.65625 7.34375V10.1562H6.84375C6.61997 10.1562 6.40536 10.2451 6.24713 10.4034C6.08889 10.5616 6 10.7762 6 11C6 11.2238 6.08889 11.4384 6.24713 11.5966C6.40536 11.7549 6.61997 11.8438 6.84375 11.8438H9.65625V14.6562C9.65625 14.88 9.74515 15.0946 9.90338 15.2529C10.0616 15.4111 10.2762 15.5 10.5 15.5C10.7238 15.5 10.9384 15.4111 11.0966 15.2529C11.2549 15.0946 11.3438 14.88 11.3438 14.6562V11.8438H14.1562C14.38 11.8438 14.5946 11.7549 14.7529 11.5966C14.9111 11.4384 15 11.2238 15 11C15 10.7762 14.9111 10.5616 14.7529 10.4034C14.5946 10.2451 14.38 10.1562 14.1562 10.1562H11.3438V7.34375Z"
              fill="#1D4ED8"
            />
          </svg>
          <span
            style={{
              fontSize: "0.8rem",
              marginLeft: "0.5rem",
              whiteSpace: "nowrap",
              display: "inline-block",
            }}
          >
            Add Option
          </span>
        </div>
      </button>
    </div>
  );
}
export default SingleAnswerSection;
