"use client";

import { stepTwoSections } from "@/config/constants";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { cn } from "@/lib/strings";
import { type ComponentPropsWithoutRef, type FC } from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const AssignmentQuestionControls: FC<Props> = () => {
  const [questionControls, setQuestionControls] = useAssignmentConfig(
    (state) => [state.questionControls, state.setQuestionControls],
  );

  const handleToggle = (
    key: "allowCopy" | "allowPaste" | "allowRightClick" | "preventPrint",
  ) => {
    const newValue = !questionControls?.[key];
    const newControls = {
      ...questionControls,
      [key]: newValue,
    };

    if (process.env.NODE_ENV === "development") {
      console.log(`=== Toggle ${key} ===`);
      console.log(`Old value:`, questionControls?.[key]);
      console.log(`New value:`, newValue);
      console.log(`Full questionControls:`, newControls);
    }

    setQuestionControls(newControls);
  };

  return (
    <SectionWithTitle
      title="Question Controls"
      description="Configure what actions learners can perform while taking the assignment"
      className="flex flex-col gap-y-4"
    >
      <div className="flex flex-col gap-y-3">
        <ControlToggle
          label="Allow Copying"
          description="Let learners copy question text and their answers"
          checked={questionControls?.allowCopy ?? false}
          onChange={() => handleToggle("allowCopy")}
        />
        <ControlToggle
          label="Allow Pasting"
          description="Let learners paste content into answer fields"
          checked={questionControls?.allowPaste ?? false}
          onChange={() => handleToggle("allowPaste")}
        />
        <ControlToggle
          label="Allow Right Click"
          description="Let learners access the context menu with right click"
          checked={questionControls?.allowRightClick ?? false}
          onChange={() => handleToggle("allowRightClick")}
        />
      </div>

      <div className="mt-2 pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Security Controls
        </h3>
        <div className="flex flex-col gap-y-3">
          <ControlToggle
            label="Prevent Printing"
            description="Block print attempts (Ctrl/Cmd+P) during the assignment. Users can still screenshot, but they cannot download the assignment by printing it."
            checked={questionControls?.preventPrint ?? false}
            onChange={() => handleToggle("preventPrint")}
            variant="prevent"
          />
        </div>
      </div>
    </SectionWithTitle>
  );
};

interface ControlToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  variant?: "allow" | "prevent";
}

const ControlToggle: FC<ControlToggleProps> = ({
  label,
  description,
  checked,
  onChange,
  variant = "allow",
}) => {
  const bgColor =
    variant === "prevent"
      ? checked
        ? "bg-orange-600"
        : "bg-gray-200"
      : checked
        ? "bg-violet-600"
        : "bg-gray-200";

  const ringColor =
    variant === "prevent" ? "focus:ring-orange-600" : "focus:ring-violet-600";

  return (
    <div className="flex items-start justify-between p-4 border border-gray-200 rounded-md hover:border-gray-300 transition-colors">
      <div className="flex-1">
        <h3 className="text-sm font-medium text-gray-900">{label}</h3>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
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
