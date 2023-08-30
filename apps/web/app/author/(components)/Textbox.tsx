"use client";

import MultipleChoiceQuestion from "@/app/learner/(components)/MultipleChoiceQuestion";
import TextQuestion from "@/app/learner/(components)/TextQuestion";
import Dropdown from "@authorComponents/Dropdown";
import MarkdownEditor from "@components/MarkDownEditor";
import { Listbox, RadioGroup, Transition } from "@headlessui/react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/solid";
import React, { Fragment, useEffect, useRef, useState } from "react";
import MultipleAnswerSection from "./MultipleAnswerSection";
import RubricTable from "./RubricTable";
import WrittenQuestionView from "./WrittenQuestionView";

//////////////////Answer Type////////////////////////////////////////
const answerTypes = [
  {
    title: "Single Answer",
    description: "This multiple choice should have exactly one answer.",
    current: false,
  },
  {
    title: "Multiple Answer",
    description: "This multiple choice can have zero or more than one answer",
    current: false,
  },
  {
    title: "Text",
    description: "This question has a written answer",
    current: false,
  },
];
function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

const rubrics = [
  {
    criteria: "Novelty",
    judgement: "Does it contain copy of existing product?",
    rate: "10",
    weight: "40%",
  },
  // More people...
];

//////////////////////////Single Multiple Choice Type////////////////////////////////////////////
const singleAnswer = [
  {
    name: "Public access",
    description: "This project would be available to anyone who has the link",
  },
  {
    name: "Private to Project Members",
    description: "Only members of this project would be able to access",
  },
  {
    name: "Private to you",
    description: "You are the only one able to access this project",
  },
];

enum QuestionType {
  SingleCorrect = "single_correct",
  MultipleAnswers = "multiple_answers",
  WrittenQuestion = "written_question",
}

function TextBox() {
  const [isLearnerView, setIsLearnerView] = useState(false);
  const [inputText, setInputText] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedQuestionType, setSelectedQuestionType] =
    useState<QuestionType | null>(null);
  const [optionsSingleCorrect, setOptionsSingleCorrect] = useState<string[]>(
    []
  );
  const [selectedOptionSingleCorrect, setSelectedOptionSingleCorrect] =
    useState<string | null>(null);
  const [optionsMultipleAnswers, setOptionsMultipleAnswers] = useState<
    string[]
  >([]);
  const [selectedOptionsMultipleAnswers, setSelectedOptionsMultipleAnswers] =
    useState<string[]>([]);
  const [writtenQuestionText, setWrittenQuestionText] = useState("");
  const [questions, setQuestions] = useState<Array<JSX.Element>>([]);
  const [jsonData, setJsonData] = useState<{
    inputText: string;
    displayText: string;
    questionType: QuestionType | null;
    optionsSingleCorrect: string[];
    selectedOptionSingleCorrect: string | null;
    optionsMultipleAnswers: string[];
    selectedOptionsMultipleAnswers: string[];
    writtenQuestionText: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isTableMode, setIsTableMode] = useState(false);
  const [optionsWrittenQuestion, setOptionsWrittenQuestion] = useState<
    string[]
  >([]);
  const [isActive, setIsActive] = useState(false); // Track the active state of the component
  const [score, setScore] = useState("");
  const [switchState, setSwitchState] = useState("a");
  const [answerTypeSelected, setAnswerTypeSelected] = useState(answerTypes[0]); // use this the change the state of the answer type (single multiple written)

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const generateJsonData = () => {
    const data = {
      inputText,
      displayText,
      questionType: selectedQuestionType,
      optionsSingleCorrect,
      selectedOptionSingleCorrect,
      optionsMultipleAnswers,
      selectedOptionsMultipleAnswers,
      writtenQuestionText,
    };

    setJsonData(data);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  };

  const handleDisplayText = () => {
    setDisplayText(inputText);
  };

  const handleMenuToggle = () => {
    setIsMenuOpen((prevIsMenuOpen) => !prevIsMenuOpen);
  };

  const handleQuestionTypeSelect = (questionType: QuestionType) => {
    setSelectedQuestionType(questionType);
    setIsMenuOpen(false);
    setOptionsSingleCorrect([]);
    setSelectedOptionSingleCorrect(null);
    setWrittenQuestionText("");
  };

  const handleOptionChangeSingleCorrect = (index: number, value: string) => {
    const updatedOptions = [...optionsSingleCorrect];
    updatedOptions[index] = value;
    setOptionsSingleCorrect(updatedOptions);
  };

  const handleOptionToggleSingleCorrect = (index: number) => {
    setSelectedOptionSingleCorrect((prevSelectedOption) => {
      return prevSelectedOption === optionsSingleCorrect[index]
        ? null
        : optionsSingleCorrect[index];
    });
  };

  const handleOptionToggleMultipleAnswers = (option: string) => {
    setSelectedOptionsMultipleAnswers((prevSelectedOptions) => {
      if (prevSelectedOptions.includes(option)) {
        return prevSelectedOptions.filter(
          (selectedOption) => selectedOption !== option
        );
      } else {
        return [...prevSelectedOptions, option];
      }
    });
  };

  const handleOptionChangeMultipleAnswers = (index: number, value: string) => {
    const updatedOptions = [...optionsMultipleAnswers];
    updatedOptions[index] = value;
    setOptionsMultipleAnswers(updatedOptions);
  };

  const handleWrittenQuestionChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setWrittenQuestionText(event.target.value);
  };

  const handleOptionChangeWrittenQuestion = (index: number, value: string) => {
    const updatedOptions = [...optionsWrittenQuestion];
    updatedOptions[index] = value;
    setOptionsWrittenQuestion(updatedOptions);
  };

  const handleAddOptionWrittenQuestion = () => {
    setOptionsWrittenQuestion([...optionsWrittenQuestion, ""]);
  };

  const handleRemoveOptionWrittenQuestion = (index: number) => {
    const updatedOptions = optionsWrittenQuestion.filter((_, i) => i !== index);
    setOptionsWrittenQuestion(updatedOptions);
  };

  const handleScore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newScore = event.target.value;
    setScore(newScore);
  };

  return (
    <div
      className={`relative flex flex-col pl-2 rounded-md p-4 mx-auto my-auto`}
      style={{
        width: "67rem",
        minHeight: "30.5rem",
        maxWidth: "100%",
      }}
    >
      {/* Toggle view button */}
      <button
        className="w-52 rounded-md bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-indigo-100 ml-[380px]"
        onClick={() => setIsLearnerView(!isLearnerView)}
      >
        {isLearnerView ? "Author View" : "Learner View"}
      </button>

      {isLearnerView ? (
        <div>
          {selectedQuestionType === QuestionType.SingleCorrect ||
          selectedQuestionType === QuestionType.MultipleAnswers ? (
            <MultipleChoiceQuestion
            // questionData={{}}
            />
          ) : selectedQuestionType === QuestionType.WrittenQuestion ? (
            <TextQuestion
              // questionData={{}}
              questionNumber={questions.length + 1}
            />
          ) : null}
        </div>
      ) : (
        <div
          className="flex flex-col mt-8 bg-white transition border-l-8 rounded-md p-10 border-blue-700"
          style={{
            minWidth: "62.5625rem",
            minHeight: "25.5rem",
          }}
        >
          Question:
          {/* <button
        className="bg-blue-500 text-white p-2 rounded-md ml-2"
        onClick={generateJsonData}
      >
        Convert to JSON
      </button> */}
          {jsonData && (
            <div className="mt-4">
              <p>Generated JSON Data:</p>
              <pre className="bg-gray-100 p-2 rounded-md text-black overflow-auto">
                {JSON.stringify(jsonData, null, 2)}
              </pre>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <MarkdownEditor
              style={{ height: "150px", width: "1200px" }}
              value={inputText}
              setValue={setInputText}
            />
          </div>
          {/* <div className="mt-2">
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={handleDisplayText}
        >
          Display Text
        </button>
      </div>
      {displayText && (
        <div className="mt-4">
          <p>Displayed Text:</p>
          <p className="bg-gray-100 p-2 rounded-md text-black">{displayText}</p>
        </div>
      )} */}
          <div className="text-m text-black font-inter text-1rem leading-1.25rem mr-2 h-4 mt-[20px]">
            How would you like your question type?
          </div>
          <div className="my-[20px]">
            <Dropdown
              answerTypeSelected={answerTypeSelected}
              setAnswerTypeSelected={setAnswerTypeSelected}
              answerTypes={answerTypes}
            />
          </div>
          {answerTypeSelected === answerTypes[0] ? (
            <div className="mt-4">
              <p>Options:</p>
              {optionsSingleCorrect.map((option, index) => (
                <div key={index} className="flex items-center">
                  <input
                    type="radio"
                    name="singleCorrectOption"
                    value={option}
                    checked={option === selectedOptionSingleCorrect}
                    onChange={() => handleOptionToggleSingleCorrect(index)}
                    className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <input
                    type="text"
                    className="p-2 rounded-md text-black bg-transparent outline-none w-full" // Removed 'border ml-2' and added 'w-full'
                    placeholder={`Option ${index + 1}`}
                    value={option}
                    onChange={(event) =>
                      handleOptionChangeSingleCorrect(index, event.target.value)
                    }
                    style={{
                      height: "2.125rem",
                      maxWidth: "100%",
                    }}
                  />
                  <button
                    className="ml-2 text-red-600"
                    onClick={() => {
                      const updatedOptions = [...optionsSingleCorrect];
                      updatedOptions.splice(index, 1);
                      setOptionsSingleCorrect(updatedOptions);
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
                </div>
              ))}
              <button
                type="button"
                className="rounded-full w-[140px] bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-200"
                onClick={() =>
                  setOptionsSingleCorrect([...optionsSingleCorrect, ""])
                }
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
                  <span style={{ fontSize: "0.8rem", marginLeft: "0.5rem" }}>
                    Add Option
                  </span>
                </div>
              </button>
            </div>
          ) : null}
          {answerTypeSelected === answerTypes[1] ? (
            <MultipleAnswerSection
              optionsMultipleAnswers={optionsMultipleAnswers}
              selectedOptionsMultipleAnswers={selectedOptionsMultipleAnswers}
              setOptionsMultipleAnswers={setOptionsMultipleAnswers}
              handleOptionToggleMultipleAnswers={
                handleOptionToggleMultipleAnswers
              }
              handleInputChange={handleInputChange}
              handleOptionChangeMultipleAnswers={
                handleOptionChangeMultipleAnswers
              }
              setSelectedOptionsMultipleAnswers={
                setSelectedOptionsMultipleAnswers
              }
            />
          ) : null}
          {answerTypeSelected === answerTypes[2] && (
            <WrittenQuestionView
              handleScore={handleScore}
              score={score}
              switchState={switchState}
              setSwitchState={setSwitchState}
              optionsWrittenQuestion={optionsWrittenQuestion}
              handleOptionChangeWrittenQuestion={
                handleOptionChangeWrittenQuestion
              }
              handleRemoveOptionWrittenQuestion={
                handleRemoveOptionWrittenQuestion
              }
              handleAddOptionWrittenQuestion={handleAddOptionWrittenQuestion}
              rubrics={rubrics}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default TextBox;
