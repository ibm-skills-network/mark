"use client";

import { stepTwoSections } from "@/config/constants";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import type { ComponentPropsWithoutRef, FC, MouseEvent } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

interface Props extends ComponentPropsWithoutRef<"div"> {}

const Component: FC<Props> = () => {
  const [displayOrder, setDisplayOrder, errors] = useAssignmentConfig(
    (state) => [state.displayOrder, state.setDisplayOrder, state.errors],
  );
  function handleGradedChange(e: MouseEvent<HTMLButtonElement>) {
    setDisplayOrder(e.currentTarget.value === "DEFINED" ? "DEFINED" : "RANDOM");
  }

  return (
    <SectionWithTitle
      title={stepTwoSections.order.title}
      className="flex flex-col gap-y-6"
      required
    >
      <button onClick={handleGradedChange} type="button" value="DEFINED">
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                displayOrder === "DEFINED" && "bg-violet-600",
              )}
            />
          </div>
          <p
            className={cn(
              "leading-5 transition-all cursor-pointer",
              displayOrder === "DEFINED"
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            Strict
          </p>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          Questions will appear in the order that you assign.
        </p>
      </button>

      <button onClick={handleGradedChange} type="button" value="RANDOM">
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full",
                displayOrder === "RANDOM" && "bg-violet-600",
              )}
            />
          </div>
          <div
            className={cn(
              "leading-5 cursor-pointer transition-all",
              displayOrder === "RANDOM"
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            Randomized
          </div>
        </div>
        <p className="text-gray-500 text-left cursor-pointer">
          Questions will be shuffled each time the learner loads the assignment.
        </p>
      </button>
      {errors.displayOrder && (
        <p className="text-red-500 text-sm" id={`error-${errors.displayOrder}`}>
          {errors.displayOrder}
        </p>
      )}
    </SectionWithTitle>
  );
};

export default Component;
