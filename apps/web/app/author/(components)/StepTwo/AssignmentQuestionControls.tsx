"use client";

import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { cn } from "@/lib/strings";
import { type ComponentPropsWithoutRef, type FC } from "react";
import { SectionWithTitle } from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div"> & { compact?: boolean };

const AssignmentQuestionControls: FC<Props> = ({ compact }) => {
  const [questionControls, setQuestionControls] = useAssignmentConfig(
    (state) => [state.questionControls, state.setQuestionControls],
  );

  const handleToggle = (
    key: "disableCopy" | "disablePaste" | "disableRightClick" | "disablePrint",
  ) => {
    const newValue = !questionControls?.[key];
    const newControls = {
      ...questionControls,
      [key]: newValue,
    };
    setQuestionControls(newControls);
  };

  return (
    <SectionWithTitle
      title="Assignment Restrictions"
      description="Configure restrictions to prevent unauthorized behaviors during the assignment"
      className="flex flex-col gap-y-4"
      compact={compact}
    >
      <div className="flex flex-col gap-y-3">
        <ControlToggle
          label="Disable Copying"
          description="Prevent learners from copying question text or answers. Enable this to discourage sharing or plagiarism."
          checked={questionControls?.disableCopy ?? false}
          onChange={() => handleToggle("disableCopy")}
        />
        <ControlToggle
          label="Disable Pasting"
          description="Prevent learners from pasting content into answer fields. Enable this to ensure original work or test typing skills."
          checked={questionControls?.disablePaste ?? false}
          onChange={() => handleToggle("disablePaste")}
        />
        <ControlToggle
          label="Disable Right Click"
          description="Prevent learners from accessing the right-click context menu. Enable this to reduce copying or accessing browser features."
          checked={questionControls?.disableRightClick ?? false}
          onChange={() => handleToggle("disableRightClick")}
        />
        <ControlToggle
          label="Disable Printing"
          description="Block print attempts (Ctrl/Cmd+P) during the assignment. Enable this to prevent downloading or distributing the assignment."
          checked={questionControls?.disablePrint ?? false}
          onChange={() => handleToggle("disablePrint")}
        />
      </div>
    </SectionWithTitle>
  );
};

interface ControlToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

const ControlToggle: FC<ControlToggleProps> = ({
  label,
  description,
  checked,
  onChange,
}) => {
  const bgColor = checked ? "bg-violet-600" : "bg-gray-200 dark:bg-gray-700";
  const ringColor = "focus:ring-violet-600";

  return (
    <div className="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-md hover:border-gray-300 transition-colors">
      <div className="flex-1">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2",
          bgColor,
          ringColor,
        )}
        role="switch"
        aria-checked={checked}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
};

export default AssignmentQuestionControls;
