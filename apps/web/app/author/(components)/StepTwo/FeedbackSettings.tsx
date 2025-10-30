"use client";

import { cn } from "@/lib/strings";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import type { CorrectAnswerVisibility } from "@/config/types";

interface SettingItemProps {
  title: string;
  description: string;
  lastItem: boolean;
  value: boolean;
  toggleValue: () => void;
}

const SettingItem: React.FC<SettingItemProps> = ({
  title,
  description,
  lastItem,
  value,
  toggleValue,
}) => {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 py-2 w-full max-md:flex-wrap max-md:max-w-full justify-between",
        !lastItem && "border-b",
      )}
    >
      <div className="flex flex-col justify-center text-base leading-6 font-[450]">
        <div className="text-black max-md:max-w-full">{title}</div>
        <div className="text-gray-600 max-md:max-w-full">{description}</div>
      </div>
      <button
        type="button"
        onClick={toggleValue}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
          value ? "bg-violet-600" : "bg-gray-200",
        )}
        role="switch"
        aria-checked={value}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
            value ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
};

interface CorrectAnswerSettingProps {
  title: string;
  description: string;
  value: CorrectAnswerVisibility;
  onChange: (value: CorrectAnswerVisibility) => void;
}

const CorrectAnswerSetting: React.FC<CorrectAnswerSettingProps> = ({
  title,
  description,
  value,
  onChange,
}) => {
  const showCorrectAnswers = value !== "NEVER";

  const handleToggleChange = () => {
    if (showCorrectAnswers) {
      onChange("NEVER");
    } else {
      onChange("ALWAYS");
    }
  };

  const radioOptions = [
    {
      value: "ON_PASS" as const,
      label: "Show only on pass",
      description: "Correct answers will only be visible when learners pass",
    },
    {
      value: "ALWAYS" as const,
      label: "Always show",
      description: "Correct answers will always be visible after submission",
    },
  ];

  return (
    <div className="flex items-start gap-1.5 py-4 w-full max-md:flex-wrap max-md:max-w-full justify-between border-b">
      <div className="flex flex-col justify-center text-base leading-6 font-[450] flex-1">
        <div className="text-black max-md:max-w-full">{title}</div>
        <div className="text-gray-600 max-md:max-w-full mb-3">
          {description}
        </div>

        {showCorrectAnswers && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700 mb-2">
              When to show:
            </div>
            {radioOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 cursor-pointer"
              >
                <input
                  type="radio"
                  name="correctAnswerVisibility"
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                  className="mt-1 h-4 w-4 text-violet-600 focus:ring-violet-500 border-gray-300"
                />

                <div className="flex-1">
                  <div className="font-medium text-gray-900">
                    {option.label}
                  </div>
                  <div className="text-sm text-gray-500">
                    {option.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showCorrectAnswers}
            onChange={handleToggleChange}
            className="sr-only"
          />

          <div
            className={`relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-violet-300 rounded-full peer ${showCorrectAnswers ? "bg-violet-600" : "bg-gray-200"} transition-colors`}
          >
            <div
              className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform ${showCorrectAnswers ? "transform translate-x-5" : ""}`}
            ></div>
          </div>
        </label>
      </div>
    </div>
  );
};

const SettingsContainer: React.FC = () => {
  const {
    toggleShowAssignmentScore,
    toggleShowSubmissionFeedback,
    toggleShowQuestionScore,
    toggleShowQuestions,
    setCorrectAnswerVisibility,
    showAssignmentScore,
    showSubmissionFeedback,
    showQuestionScore,
    showQuestions,
    correctAnswerVisibility,
  } = useAssignmentFeedbackConfig();

  const settingsData = [
    {
      title: "Total assignment score",
      description: "The total assignment score will be visible.",
      value: showAssignmentScore,
      toggleValue: toggleShowAssignmentScore,
    },
    {
      title: "Individual question scores",
      description: "The score earned for each question will be shown.",
      value: showQuestionScore,
      toggleValue: toggleShowQuestionScore,
    },
    {
      title: "Explanation and relevant knowledge",
      description:
        "A detailed answer explanation and/or related topics and labs will be given.",
      value: showSubmissionFeedback,
      toggleValue: toggleShowSubmissionFeedback,
    },
    {
      title: "Show Questions",
      description:
        "The questions will be visible to the learner after submission",
      value: showQuestions,
      toggleValue: toggleShowQuestions,
    },
  ] as const;
  return (
    <section className="flex flex-col border-transparent">
      {settingsData.map((setting, index) => (
        <SettingItem
          key={index}
          title={setting.title}
          description={setting.description}
          lastItem={false}
          value={setting.value}
          toggleValue={setting.toggleValue}
        />
      ))}

      <CorrectAnswerSetting
        title="Show Correct Answers"
        description="Choose when correct answers should be visible to learners."
        value={correctAnswerVisibility}
        onChange={setCorrectAnswerVisibility}
      />
    </section>
  );
};

export default SettingsContainer;
