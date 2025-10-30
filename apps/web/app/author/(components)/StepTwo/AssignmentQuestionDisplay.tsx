"use client";

import { stepTwoSections } from "@/config/constants";
import { QuestionDisplayType } from "@/config/types";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import type { ComponentPropsWithoutRef, FC, MouseEvent } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
  const [questionDisplay, setQuestionDisplay, errors] = useAssignmentConfig(
    (state) => [state.questionDisplay, state.setQuestionDisplay, state.errors],
  );
  function handleChangeQuestionDisplay(e: MouseEvent<HTMLButtonElement>) {
    setQuestionDisplay(e.currentTarget.value as QuestionDisplayType);
  }

  return (
    <SectionWithTitle
      title={stepTwoSections.questionDisplay.title}
      className="flex flex-col gap-y-6"
      required
    >
      <button
        onClick={handleChangeQuestionDisplay}
        type="button"
        value="ONE_PER_PAGE"
      >
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                questionDisplay === "ONE_PER_PAGE" && "bg-violet-600",
              )}
            />
          </div>
          <p
            className={cn(
              "leading-5 transition-all cursor-pointer",
              questionDisplay === "ONE_PER_PAGE"
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            One question per page
          </p>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          Each question will be displayed on a separate page for the learner to
          answer
        </p>
      </button>

      <button
        onClick={handleChangeQuestionDisplay}
        type="button"
        value="ALL_PER_PAGE"
      >
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                questionDisplay === "ALL_PER_PAGE" && "bg-violet-600",
              )}
            />
          </div>
          <div
            className={cn(
              "leading-5 cursor-pointer transition-all",
              questionDisplay === "ALL_PER_PAGE"
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            All questions in one page
          </div>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          All questions will be displayed on one page for the learner to answer
        </p>
      </button>
      {errors.questionDisplay && (
        <p
          className="text-red-500 text-sm"
          id={`error-${errors.questionDisplay}`}
        >
          {errors.questionDisplay}
        </p>
      )}
    </SectionWithTitle>
  );
};

export default Component;
