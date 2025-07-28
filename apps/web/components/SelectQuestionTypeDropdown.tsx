"use client";

import Tooltip from "@/components/Tooltip";
import type { QuestionType, QuestionTypeDropdown } from "@/config/types";
import { cn } from "@/lib/strings";
import { useEffect, useRef, useState } from "react";

interface DropdownProps {
  questionType: QuestionType;
  setQuestionType: (value: QuestionType) => void;
  questionTypes: QuestionTypeDropdown[];
  [key: string]: unknown;
}

function Dropdown(props: DropdownProps) {
  const { questionType, setQuestionType, questionTypes, ...rest } = props;

  const [isOpen, setIsOpen] = useState<boolean>(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleModelPicker = () => {
    setIsOpen((prevState) => !prevState);
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  };

  const handleSelectQuestionType = (newQuestionType: QuestionType) => {
    setQuestionType(newQuestionType);
    setIsOpen(false);
  };

  useEffect(() => {
    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative max-w-[16rem]" ref={dropdownRef}>
      <Tooltip distance={0} content="" disabled={true}>
        <button
          type="button"
          onClick={toggleModelPicker}
          className={cn(
            "w-full transition-all flex justify-between items-center pl-4 px-3 py-3 text-left border border-gray-300 focus:outline-none focus:border-transparent focus:ring-1 focus:ring-purple-600",
            isOpen ? "rounded-t-md ring-purple-600 ring-1" : "rounded-md",
          )}
          {...rest}
        >
          <p
            className={cn(
              "whitespace-nowrap overflow-hidden overflow-ellipsis w-full text-sm transition-colors",
              questionType
                ? " font-medium text-gray-700"
                : " text-gray-500 dark:text-gray-500",
            )}
          >
            {questionTypes.find((question) => question.value === questionType)
              ?.label ?? "Select a question type"}
          </p>

          <svg
            className={cn("transition", isOpen ? "rotate-180" : "")}
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Dropdown Arrow</title>
            <path
              strokeWidth={1}
              d="M6 9L10 13L14 9"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>

      <div
        className={cn(
          "pb-1 absolute w-full bg-white rounded-b-md shadow-lg border border-gray-300 origin-top duration-150 z-10",
          isOpen ? "scale-100" : "scale-0",
        )}
      >
        {questionTypes.map((question) => (
          <Tooltip
            key={question.value}
            content={question.description}
            disabled={true}
          >
            <li
              className={cn(
                "block px-4 border-t border-gray-300 py-3 text-sm cursor-pointer transition",
                questionType === question.value
                  ? "hover:bg-violet-700 bg-violet-600 text-white"
                  : "hover:bg-gray-100 ",
              )}
              onClick={() => handleSelectQuestionType(question.value)}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSelectQuestionType(question.value);
                }
              }}
            >
              {question.label}
            </li>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export default Dropdown;
