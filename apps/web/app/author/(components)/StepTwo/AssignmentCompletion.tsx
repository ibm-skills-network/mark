"use client";
import type { ComponentPropsWithoutRef, FC } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";
import { stepTwoSections } from "@/app/author/[assignmentId]/config/page";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import Dropdown from "@/components/Dropdown";
import Tooltip from "@/components/Tooltip";
import { InformationCircleIcon } from "@heroicons/react/24/solid";

interface Props extends ComponentPropsWithoutRef<"div"> {}

const Component: FC<Props> = () => {
  const [numAttempts, setNumAttempts, passingGrade, setPassingGrade] =
    useAssignmentConfig((state) => [
      state.numAttempts,
      state.setNumAttempts,
      state.passingGrade,
      state.setPassingGrade,
    ]);

  const dropdownItems = [
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
    { value: 5, label: "5" },
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
          selectedItem={numAttempts || -1}
          setSelectedItem={setNumAttempts}
        />
      </div>
      <div className="flex flex-col gap-y-1">
        <p className=" text-gray-600">
          What is the passing threshold (in percentage)?
        </p>
        <input
          type="number"
          className="border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 px-4 py-2 w-full"
          placeholder="Ex. 70"
          min={0}
          max={100}
          step={5}
          onChange={(e) => setPassingGrade(~~e.target.value)}
          value={passingGrade || ""}
        />
      </div>
    </SectionWithTitle>
  );
};

export default Component;
