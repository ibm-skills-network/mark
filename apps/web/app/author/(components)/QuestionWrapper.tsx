"use client";

import Dropdown from "@/components/Dropdown";
import Tooltip from "@/components/Tooltip";
import type { QuestionType, QuestionTypeDropdown } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import MarkdownEditor from "@components/MarkDownEditor";
import { QuestionMarkCircleIcon } from "@heroicons/react/24/solid";
import { ComponentPropsWithoutRef, useEffect, useRef, useState } from "react";
import MultipleAnswerSection from "./Questions/QuestionTypes/MultipleAnswerSection";
import TextBasedAnswerSection from "./Questions/QuestionTypes/TextBasedAnswerSection";

const questionTypes = [
  {
    label: "Text",
    description: "This question has a written answer",
    value: "TEXT",
  },
  {
    label: "Url",
    description: "This question has a written answer",
    value: "URL",
  },
  // {
  //   label: "Single Answer",
  //   description: "This multiple choice should have exactly one answer.",
  //   value: "SINGLE_CORRECT",
  // },
  // {
  //   label: "Multiple Choice",
  //   description: "This multiple choice can have zero or more than one answer",
  //   value: "MULTIPLE_CORRECT",
  // },
] as QuestionTypeDropdown[];
interface TextBoxProps extends ComponentPropsWithoutRef<"div"> {
  questionId: number;
}

function QuestionWrapper(props: TextBoxProps) {
  const { questionId, ...rest } = props;
  const [isLearnerView, setIsLearnerView] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [
    questions,
    setQuestions,
    removeQuestion,
    addQuestion,
    activeAssignmentId,
    modifyQuestion,
  ] = useAuthorStore((state) => [
    state.questions,
    state.setQuestions,
    state.removeQuestion,
    state.addQuestion,
    state.activeAssignmentId,
    state.modifyQuestion,
  ]);

  const question = questions.find((question) => question.id === questionId);

  const menuRef = useRef<HTMLDivElement>(null);
  const [choicesWrittenQuestion, setChoicesWrittenQuestion] = useState<
    string[]
  >([]);

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

  const handleQuestionTextChange = (value: string) => {
    modifyQuestion(questionId, {
      question: value,
    });
  };
  function setQuestionType(questionType: QuestionType) {
    modifyQuestion(questionId, {
      type: questionType,
      // if question type is multiple choice, we need to set the scoring to null
      scoring:
        questionType === "MULTIPLE_CORRECT" || questionType === "SINGLE_CORRECT"
          ? null
          : question.scoring,
    });
  }

  return (
    <div
      {...rest}
      className={`relative flex flex-col flex-1 w-[64rem] rounded-md bg-white transition border-l-8 border-y border-r border-y-gray-300 border-r-gray-300 py-10 px-12 border-l-blue-700 gap-y-8`}
    >
      {/* Toggle view button */}
      {/* <button
        className="w-52 rounded-md bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-indigo-100 ml-[380px]"
        onClick={() => setIsLearnerView(!isLearnerView)}
      >
        {isLearnerView ? "Author View" : "Learner View"}
      </button>

      {isLearnerView ? (
        <div>
          {question.type === "MULTIPLE_CORRECT" ? (
            <MultipleChoiceQuestion
              questionData={{
                question: question.question,
                choices: question.choices,
                answer: question.answer,
                totalPoints: question.totalPoints,
              }}
            />
          ) : question.type === "TEXT" ? (
            <TextQuestion
              questionData={question}
            />
          ) : null}
        </div>
      ) : ( */}
      <div className="flex flex-col gap-y-2">
        Question
        <MarkdownEditor
          value={question.question}
          setValue={handleQuestionTextChange}
          placeholder="Type your question for the learner"
          className="bg-gray-600"
        />
      </div>
      <div className="flex flex-col gap-y-1">
        <p className="leading-5 flex gap-x-1">
          Response Type
          <Tooltip content="Choose how you want the learner to answer your question.">
            <QuestionMarkCircleIcon className="w-5 inline-block text-blue-500" />
          </Tooltip>
        </p>
        <Dropdown
          questionType={question.type}
          setQuestionType={setQuestionType}
          questionTypes={questionTypes}
        />
      </div>
      {question.type === questionTypes[0].value ||
      question.type === questionTypes[1].value ? (
        <TextBasedAnswerSection
          questionId={questionId}
          isUrl={question.type === questionTypes[1].value}
        />
      ) : null}

      {/* {questionType === questionTypes[0] ? (
            <SingleAnswerSection
              choices={question.choices}
              selectedChoiceSingleCorrect={selectedChoiceSingleCorrect}
              handleChoiceToggleSingleCorrect={handleChoiceToggleSingleCorrect}
              handleChoiceChangeSingleCorrect={handleChoiceChangeSingleCorrect}
              setChoicesSingleCorrect={setChoicesSingleCorrect}
            />
          ) : null} */}

      {question.type === questionTypes[2].value ? (
        <MultipleAnswerSection questionId={questionId} />
      ) : null}
    </div>
  );
}

export default QuestionWrapper;
