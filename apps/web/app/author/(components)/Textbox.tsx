"use client";

import LongFormQuestion from "@/app/learner/(components)/LongFormQuestion";
import MultipleChoiceQuestion from "@/app/learner/(components)/MultipleChoiceQuestion";
import MarkdownEditor from "@components/MarkDownEditor";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { Listbox, Transition } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/solid'

//////////////////Answer Type////////////////////////////////////////
const answerTypes = [
  { title: 'Multiple Choice - Single Answer', description: 'This multiple choice should have exactly one answer.', current: false },
  { title: 'Multiple Choice - Multiple Answer', description: 'This multiple choice can have zero or more than one answer', current: false },
  { title: 'Written Answer', description: 'This question has a written answer', current: false },
]
function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}





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
  const [answerTypeSelected, setanswerTypeSelected] = useState(answerTypes[0]) // use this the change the state of the answer type (single multiple written)

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

  const handleFocus = () => {
    setIsActive(true); // Set isActive to true when the component is focused
  };

  const handleBlur = () => {
    setIsActive(false); // Set isActive to false when the component loses focus
  };

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
      className={`flex flex-col pl-2 rounded-md p-4 mx-auto my-auto`}
      style={{
        width: "67rem",
        minHeight: "30.5rem",
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
              maxAttempts={3}
              questionNumber={questions.length + 1}
              questionText={inputText}
              options={
                selectedQuestionType === QuestionType.SingleCorrect
                  ? optionsSingleCorrect
                  : optionsMultipleAnswers
              }
              correctOptions={
                selectedQuestionType === QuestionType.SingleCorrect
                  ? [selectedOptionSingleCorrect].filter(Boolean) // To filter out null/undefined values
                  : selectedOptionsMultipleAnswers
              }
              points={100} // Adjust as needed
              onAnswerSelected={(status) => {
                console.log(status); // Handle answer status if needed
              }}
            />
          ) : selectedQuestionType === QuestionType.WrittenQuestion ? (
            <LongFormQuestion
              questionText={writtenQuestionText}
              instructions={"Please write a detailed answer."}
              maxWords={800} // Set a default or a dynamic value
              points={40} // Set a default or a dynamic value
              questionNumber={questions.length + 1}
            />
          ) : null}
        </div>
      ) : (
        <div
          className={`flex flex-col mt-8 bg-white transition border-l-8 rounded-md p-10 ${
            isActive ? "border-blue-700" : "border-white"
          }`}
          style={{
            minWidth: "62.5625rem",
            minHeight: "25.5rem",
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
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
          <MarkdownEditor
            style={{ height: "200px", width: "800px" }}
            value={inputText}
            setValue={setInputText}
          />
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
          <div className="text-m text-black font-inter text-1rem leading-1.25rem mr-2 h-4">
            Question type:
          </div>




















          <Listbox value={answerTypeSelected} onChange={setanswerTypeSelected}>
      {({ open }) => (
        <>
          <Listbox.Label className="sr-only">Change published status</Listbox.Label>
          <div className="relative">
            <div className="inline-flex divide-x divide-indigo-700 rounded-md shadow-sm">
              <div className="inline-flex items-center gap-x-1.5 rounded-l-md bg-indigo-600 px-3 py-2 text-white shadow-sm">
                <CheckIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
                <p className="text-sm font-semibold">{answerTypeSelected.title}</p>
              </div>
              <Listbox.Button className="inline-flex items-center rounded-l-none rounded-r-md bg-indigo-600 p-2 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 focus:ring-offset-gray-50">
                <span className="sr-only">Change published status</span>
                <ChevronDownIcon className="h-5 w-5 text-white" aria-hidden="true" />
              </Listbox.Button>
            </div>

            <Transition
              show={open}
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute right-0 z-10 mt-2 w-72 origin-top-right divide-y divide-gray-200 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                {answerTypes.map((option) => (
                  <Listbox.Option
                    key={option.title}
                    className={({ active }) =>
                      classNames(
                        active ? 'bg-indigo-600 text-white' : 'text-gray-900',
                        'cursor-default select-none p-4 text-sm'
                      )
                    }
                    value={option}
                  >
                    {({ selected, active }) => (
                      <div className="flex flex-col">
                        <div className="flex justify-between">
                          <p className={selected ? 'font-semibold' : 'font-normal'}>{option.title}</p>
                          {selected ? (
                            <span className={active ? 'text-white' : 'text-indigo-600'}>
                              <CheckIcon className="h-5 w-5" aria-hidden="true" />
                            </span>
                          ) : null}
                        </div>
                        <p className={classNames(active ? 'text-indigo-200' : 'text-gray-500', 'mt-2')}>
                          {option.description}
                        </p>
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </>
      )}
    </Listbox>



























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
                    X
                  </button>
                </div>
              ))}
              <button
                className="flex items-center bg-white text-black p-2 rounded-md mt-2 space-x-1"
                onClick={() =>
                  setOptionsSingleCorrect([...optionsSingleCorrect, ""])
                }
              >
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
                <span>Add Option</span>
              </button>
            </div>
          ) : null}
          {answerTypeSelected === answerTypes[1] ? (
            <div className="mt-4">
              <p>Options:</p>
              {optionsMultipleAnswers.map((option, index) => {
                const optionId = `option_${index}`; // Generate a unique ID for each option
                return (
                  <div key={optionId} className="flex items-center">
                    <input
                      type="checkbox"
                      id={optionId}
                      checked={selectedOptionsMultipleAnswers.includes(
                        optionId
                      )}
                      onChange={() =>
                        handleOptionToggleMultipleAnswers(optionId)
                      }
                    />
                    <input
                      type="text"
                      className="p-2 rounded-md text-black bg-transparent outline-none w-full" // Removed 'border ml-2' and added 'w-full'
                      placeholder={`Option ${index + 1}`}
                      value={option}
                      onChange={(event) =>
                        handleOptionChangeMultipleAnswers(
                          index,
                          event.target.value
                        )
                      }
                      style={{
                        height: "2.125rem",
                        maxWidth: "100%",
                      }}
                    />
                    <button
                      className="ml-2 text-red-600"
                      onClick={() => {
                        const updatedOptions = optionsMultipleAnswers.filter(
                          (_, i) => i !== index
                        );
                        const updatedSelectedOptions =
                          selectedOptionsMultipleAnswers.filter(
                            (id) => id !== optionId
                          );
                        setOptionsMultipleAnswers(updatedOptions);
                        setSelectedOptionsMultipleAnswers(
                          updatedSelectedOptions
                        );
                      }}
                    >
                      X
                    </button>
                  </div>
                );
              })}
              <button
                className="flex items-center bg-white text-black p-2 rounded-md mt-2 space-x-1"
                onClick={() =>
                  setOptionsMultipleAnswers([...optionsMultipleAnswers, ""])
                }
              >
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
                <span>Add Option</span>
              </button>
            </div>
          ) : null}

          {answerTypeSelected === answerTypes[2] && (
            <div className="mt-4">
              <div style={{ width: 800, height: 104, background: "#E0E7FF" }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="65"
                  height="66"
                  viewBox="0 0 65 66"
                  fill="none"
                  style={{ transform: "translate(10px, 15px)" }} // Adjust the values as needed
                >
                  <path
                    d="M24.4342 32.5332H34.4685M24.4342 40.6582H34.4685M24.4342 48.7832H34.4685M42.496 50.8145H48.5166C50.1134 50.8145 51.6447 50.1724 52.7738 49.0296C53.9029 47.8868 54.5372 46.3369 54.5372 44.7207V16.5757C54.5372 13.5017 52.2762 10.8936 49.2498 10.639C48.249 10.555 47.2473 10.4828 46.2448 10.4224M46.2448 10.4224C46.4224 11.0049 46.5099 11.6111 46.5098 12.2207C46.5098 12.7594 46.2983 13.2761 45.922 13.657C45.5456 14.0379 45.0351 14.252 44.5029 14.252H32.4617C31.3539 14.252 30.4548 13.342 30.4548 12.2207C30.4548 11.5951 30.5485 10.9911 30.7224 10.4224M46.2448 10.4224C45.4876 7.93612 43.1971 6.12695 40.4892 6.12695H36.4754C35.189 6.12726 33.9364 6.54443 32.9012 7.31737C31.866 8.09032 31.1024 9.17843 30.7224 10.4224M30.7224 10.4224C29.7163 10.4847 28.7155 10.5578 27.7148 10.639C24.6884 10.8936 22.4273 13.5017 22.4273 16.5757V22.377M22.4273 22.377H13.3964C11.7348 22.377 10.3861 23.742 10.3861 25.4238V55.8926C10.3861 57.5745 11.7348 58.9395 13.3964 58.9395H39.4857C41.1474 58.9395 42.496 57.5745 42.496 55.8926V25.4238C42.496 23.742 41.1474 22.377 39.4857 22.377H22.4273ZM18.4136 32.5332H18.435V32.5549H18.4136V32.5332ZM18.4136 40.6582H18.435V40.6799H18.4136V40.6582ZM18.4136 48.7832H18.435V48.8049H18.4136V48.7832Z"
                    stroke="#1D4ED8"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <div
                  style={{
                    width: 223.17,
                    color: "#1D4ED8",
                    fontSize: 19.17,
                    fontWeight: "bold",
                    transform: "translate(5px, -45px)", // Adjust the vertical value as needed
                    textAlign: "center",
                  }}
                >
                  Rubric
                </div>
              </div>
              <p>Points:</p>
              <input
                type="text"
                className="p-2 border rounded-md text-gray-700 bg-transparent outline-none"
                placeholder={`ex. 10`}
                value={score}
                onChange={handleScore}
                style={{
                  maxWidth: "100%",
                }}
              />
              <div className="flex items-center">
                <label className="switch">
                  <button
                    className={`text-black bg-white hover:bg-white focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-white dark:hover:bg-gray-300 ${
                      switchState === "a" ? "bg-blue-800" : ""
                    }`}
                    onClick={() => setSwitchState("a")}
                  >
                    Single Criteria
                  </button>

                  <button
                    className={`text-black bg-white hover:bg-white focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-white dark:hover:bg-gray-300 ${
                      switchState === "b" ? "bg-blue-800" : ""
                    }`}
                    onClick={() => setSwitchState("b")}
                  >
                    Multiple Criteria
                  </button>

                  <span className="slider round"></span>
                </label>
              </div>

              {switchState === "a" && (
                <div>
                  <p>Point distribution for the Rubric</p>
                  {optionsWrittenQuestion.map((option, index) => (
                    <div key={index} className="flex items-center">
                      <input
                        type="text"
                        className="p-2 rounded-md text-black bg-transparent outline-none w-full" // Removed 'border ml-2' and added 'w-full'
                        placeholder={`Option ${index + 1}`}
                        value={option}
                        onChange={(event) =>
                          handleOptionChangeWrittenQuestion(
                            index,
                            event.target.value
                          )
                        }
                        style={{
                          height: "2.125rem",
                          maxWidth: "100%",
                        }}
                      />
                      <button
                        className="ml-2 text-red-600"
                        onClick={() => handleRemoveOptionWrittenQuestion(index)}
                      >
                        X
                      </button>
                    </div>
                  ))}
                  <button
                    className="bg-blue-500 text-white p-2 rounded-md mt-2"
                    onClick={handleAddOptionWrittenQuestion}
                  >
                    Add Option
                  </button>
                </div>
              )}

              {switchState === "b" && <div></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TextBox;
