"use client";
import type { ComponentPropsWithoutRef, FC } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";
import { stepTwoSections } from "@/config/constants";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { cn } from "@/lib/strings";

interface Props extends ComponentPropsWithoutRef<"div"> {}

const Component: FC<Props> = () => {
  const [
    allotedTimeMinutes,
    setAllotedTimeMinutes,
    timeEstimateMinutes,
    setTimeEstimateMinutes,
    strictTimeLimit,
    toggleStrictTimeLimit,
  ] = useAssignmentConfig((state) => [
    state.allotedTimeMinutes,
    state.setAllotedTimeMinutes,
    state.timeEstimateMinutes,
    state.setTimeEstimateMinutes,
    state.strictTimeLimit,
    state.toggleStrictTimeLimit,
  ]);

  return (
    <SectionWithTitle
      title={stepTwoSections.time.title}
      className="flex flex-col gap-y-6"
      required={stepTwoSections.time.required}
    >
      <div className="flex flex-col gap-y-1">
        <label className="flex gap-1.5 w-max">
          <p
            className={cn(
              "leading-5 transition-all cursor-pointer justify-center self-center after:content-['*'] after:text-transparent",
              strictTimeLimit && "after:text-violet-600",
            )}
          >
            Enforce a strict time limit for this assignment?
          </p>
          <button
            type="button"
            onClick={toggleStrictTimeLimit}
            className={cn(
              "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              strictTimeLimit ? "bg-violet-600" : "bg-gray-200",
            )}
            role="switch"
            aria-checked={strictTimeLimit}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                strictTimeLimit ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </label>
        {strictTimeLimit && (
          <input
            type="number"
            className="border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 px-4 py-2 w-full"
            placeholder="Enter time limit in minutes"
            min={0}
            step={5}
            onChange={(e) => setAllotedTimeMinutes(~~e.target.value)}
            value={allotedTimeMinutes || ""}
          />
        )}
      </div>

      <div className="flex flex-col gap-y-1">
        <p className=" text-gray-600">
          How long should learners expect to spend on this assignment (in
          minutes)?
        </p>
        <input
          type="number"
          className="border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 px-4 py-2 w-full"
          placeholder="Ex. 60"
          min={0}
          step={5}
          onChange={(e) => setTimeEstimateMinutes(~~e.target.value)}
          value={timeEstimateMinutes || ""}
        />
      </div>
    </SectionWithTitle>
  );
};

export default Component;
