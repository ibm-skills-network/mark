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
    attemptsBeforeCoolDown,
    setAttemptsBeforeCoolDown,
    retakeAttemptCoolDownMinutes,
    setRetakeAttemptCoolDownMinutes,
    errors,
  ] = useAssignmentConfig((state) => [
    state.attemptsBeforeCoolDown,
    state.setAttemptsBeforeCoolDown,
    state.retakeAttemptCoolDownMinutes,
    state.setRetakeAttemptCoolDownMinutes,
    state.errors,
  ]);

  const dropdownItems = [
    { value: 1, label: "Wait after every attempt" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
    { value: 5, label: "5" },
    { value: 10, label: "10" },
    { value: 0, label: "Never wait to retry" },
  ];
  const defaultCoolDownTimes = [
    { value: 5, label: "5 minutes" },
    { value: 10, label: "10 minutes" },
    { value: 60, label: "1 hour" },
    { value: 300, label: "5 hours" },
    { value: 1440, label: "1 day" },
    { value: 10080, label: "7 days" },
    { value: 0, label: "Never wait to retry" },
  ];

  return (
    <SectionWithTitle
      title={stepTwoSections.retakes.title}
      className="flex flex-col gap-y-6"
      required
    >
      <div className="flex flex-col gap-y-1">
        <label
          htmlFor="attempts-before-cooldown-period"
          className="text-gray-600 flex gap-x-1"
        >
          How many attempts do learners have before they have to wait to retake
          the assignment?
          <Tooltip content="The number of times a student can submit this assignment before they have to wait to retake it">
            <InformationCircleIcon className="w-5 inline-block text-gray-500" />
          </Tooltip>
        </label>
        <Dropdown<number>
          id="attempts-before-cooldown-period"
          items={dropdownItems}
          selectedItem={attemptsBeforeCoolDown}
          setSelectedItem={setAttemptsBeforeCoolDown}
        />
        {errors.attemptsBeforeCoolDown && (
          <p
            className="text-red-500 text-sm"
            id={`error-${errors.attemptsBeforeCoolDown}`}
          >
            {errors.attemptsBeforeCoolDown}
          </p>
        )}
      </div>
      {attemptsBeforeCoolDown > 0 && (
        <div className="flex flex-col gap-y-1">
          <label
            htmlFor="cooldown-period"
            className="text-gray-600 flex gap-x-1"
          >
            How long do learners have to wait before making another attempt?
            <Tooltip content="The number of times a student can submit this assignment before they have to wait to retake it">
              <InformationCircleIcon className="w-5 inline-block text-gray-500" />
            </Tooltip>
          </label>
          <Dropdown<number>
            id="cooldown-period"
            items={defaultCoolDownTimes}
            selectedItem={retakeAttemptCoolDownMinutes}
            setSelectedItem={setRetakeAttemptCoolDownMinutes}
          />
          {errors.retakeAttemptCoolDownMinutes && (
            <p
              className="text-red-500 text-sm"
              id={`error-${errors.retakeAttemptCoolDownMinutes}`}
            >
              {errors.retakeAttemptCoolDownMinutes}
            </p>
          )}
        </div>
      )}
    </SectionWithTitle>
  );
};

export default Component;
