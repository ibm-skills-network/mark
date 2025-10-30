"use client";

import { stepTwoSections } from "@/config/constants";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useEffect, type ComponentPropsWithoutRef, type FC } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
  const [
    allotedTimeMinutes,
    setAllotedTimeMinutes,
    timeEstimateMinutes,
    setTimeEstimateMinutes,
    strictTimeLimit,
    toggleStrictTimeLimit,
    setStrictTimeLimit,
    errors,
  ] = useAssignmentConfig((state) => [
    state.allotedTimeMinutes,
    state.setAllotedTimeMinutes,
    state.timeEstimateMinutes,
    state.setTimeEstimateMinutes,
    state.strictTimeLimit,
    state.toggleStrictTimeLimit,
    state.setStrictTimeLimit,
    state.errors,
  ]);

  useEffect(() => {
    if (allotedTimeMinutes > 0) {
      setStrictTimeLimit(true);
    }
  }, [allotedTimeMinutes]);

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
          <div className="relative">
            <input
              type="number"
              className={`border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 pl-4 pr-12 py-2 focus:outline-none w-full`}
              placeholder="Enter time limit in minutes"
              min={0}
              step={5}
              onChange={(e) => setAllotedTimeMinutes(~~e.target.value)}
              value={allotedTimeMinutes || ""}
            />

            <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
              min
            </span>
          </div>
        )}
      </div>

      {!strictTimeLimit && (
        <div className="flex flex-col gap-y-1">
          <p className=" text-gray-600">
            How long should learners expect to spend on this assignment (in
            minutes)?
          </p>
          <div className="relative">
            <input
              type="number"
              className={`border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 pl-4 pr-12 py-2 focus:outline-none w-full`}
              placeholder="Ex. 60"
              min={0}
              step={5}
              onChange={(e) => setTimeEstimateMinutes(~~e.target.value)}
              value={timeEstimateMinutes || ""}
            />

            <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
              min
            </span>
          </div>
        </div>
      )}
    </SectionWithTitle>
  );
};

export default Component;
