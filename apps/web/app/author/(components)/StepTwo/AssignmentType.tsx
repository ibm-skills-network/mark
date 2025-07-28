"use client";

import { stepTwoSections } from "@/config/constants";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import {
  useEffect,
  type ComponentPropsWithoutRef,
  type FC,
  type MouseEvent,
} from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
  const [graded, setGraded, errors] = useAssignmentConfig((state) => [
    state.graded,
    state.setGraded,
    state.errors,
  ]);
  function handleGradedChange(e: MouseEvent<HTMLButtonElement>) {
    setGraded(e.currentTarget.value === "graded");
  }

  return (
    <SectionWithTitle
      title={stepTwoSections.type.title}
      className="flex flex-col gap-y-6"
      required
    >
      <button onClick={handleGradedChange} type="button" value="graded">
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                graded === true && "bg-violet-600",
              )}
            />
          </div>
          <p
            className={cn(
              "leading-5 transition-all cursor-pointer",
              graded === true ? "font-bold text-violet-600" : "font-medium",
            )}
          >
            Graded
          </p>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          This assignment&apos;s score directly impacts the learner&apos;s
          overall course grade.
        </p>
      </button>

      <button onClick={handleGradedChange} type="button" value="ungraded">
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                graded === false && "bg-violet-600",
              )}
            />
          </div>
          <div
            className={cn(
              "leading-5 cursor-pointer transition-all",
              graded === false ? "font-bold text-violet-600" : "font-medium",
            )}
          >
            Practice
          </div>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          The assignment will not count towards the learner&apos;s course grade.
        </p>
      </button>
      {errors.graded && (
        <p className="text-red-500 text-sm" id={`error-${errors.graded}`}>
          {errors.graded}
        </p>
      )}
    </SectionWithTitle>
  );
};

export default Component;
