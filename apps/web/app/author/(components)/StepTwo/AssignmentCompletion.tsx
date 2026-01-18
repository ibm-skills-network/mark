"use client";

import Dropdown from "@/components/Dropdown";
import Tooltip from "@/components/Tooltip";
import { stepTwoSections } from "@/config/constants";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { InformationCircleIcon } from "@heroicons/react/24/solid";
import type { ComponentPropsWithoutRef, FC } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
  const [
    numAttempts,
    setNumAttempts,
    passingGrade,
    setPassingGrade,
    errors,
    requireAllQuestions,
    toggleRequireAllQuestions,
  ] = useAssignmentConfig((state) => [
    state.numAttempts,
    state.setNumAttempts,
    state.passingGrade,
    state.setPassingGrade,
    state.errors,
    state.requireAllQuestions,
    state.toggleRequireAllQuestions,
  ]);

  const dropdownItems = [
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
    { value: 5, label: "5" },
    { value: 6, label: "6" },
    { value: 7, label: "7" },
    { value: 8, label: "8" },
    { value: 9, label: "9" },
    { value: 10, label: "10" },
    { value: -1, label: "unlimited" },
  ];

  return (
    <SectionWithTitle
      title={stepTwoSections.completion.title}
      className="flex flex-col gap-y-6"
      required
    >
      <div className="flex flex-col gap-y-1">
        <label htmlFor="attempts" className="text-gray-600 flex gap-x-1">
          How many attempts do learners have for this assignment?
          <Tooltip content="The number of times a student can submit this assignment">
            <InformationCircleIcon className="w-5 inline-block text-gray-500" />
          </Tooltip>
        </label>
        <Dropdown<number>
          items={dropdownItems}
          selectedItem={numAttempts}
          setSelectedItem={setNumAttempts}
        />

        {errors.numAttempts && (
          <p
            className="text-red-500 text-sm"
            id={`error-${errors.numAttempts}`}
          >
            {errors.numAttempts}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-y-1">
        <p className=" text-gray-600">
          What is the passing threshold (in percentage)?
        </p>
        <div className="relative">
          <input
            type="number"
            className={`border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 pl-4 pr-10 py-2 focus:outline-none w-full`}
            placeholder="Ex. 70"
            min={0}
            max={100}
            step={5}
            onChange={(e) => setPassingGrade(~~e.target.value)}
            value={passingGrade || ""}
          />

          <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
            %
          </span>
        </div>
        {errors.passingGrade && (
          <p
            className="text-red-500 text-sm"
            id={`error-${errors.passingGrade}`}
          >
            {errors.passingGrade}
          </p>
        )}
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between">
          <label className="text-gray-600 flex gap-x-1">
            Should learners answer all questions before submitting?
            <Tooltip content="Require learners to complete all questions before submission">
              <InformationCircleIcon className="w-5 inline-block text-gray-500" />
            </Tooltip>
          </label>

          <button
            type="button"
            onClick={toggleRequireAllQuestions}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${requireAllQuestions ? "bg-violet-600" : "bg-gray-200"
              }`}
            role="switch"
            aria-checked={requireAllQuestions}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${requireAllQuestions ? "translate-x-5" : "translate-x-0"
                }`}
            />
          </button>
        </div>
      </div>

    </SectionWithTitle>
  );
};

export default Component;
