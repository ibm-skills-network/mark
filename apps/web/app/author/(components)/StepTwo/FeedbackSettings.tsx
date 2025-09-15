"use client";

import { cn } from "@/lib/strings";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";

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

const SettingsContainer: React.FC = () => {
  const {
    toggleShowAssignmentScore,
    toggleShowSubmissionFeedback,
    toggleShowQuestionScore,
    toggleShowQuestions,
    toggleShowCorrectAnswer,
    showAssignmentScore,
    showSubmissionFeedback,
    showQuestionScore,
    showQuestions,
    showCorrectAnswer,
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
    {
      title: "Show Correct Answers on Pass",
      description:
        "The correct answer will be visible to the learner only if they pass the assignment.",
      value: showCorrectAnswer,
      toggleValue: toggleShowCorrectAnswer,
    },
  ] as const;
  return (
    <section className="flex flex-col border-transparent">
      {settingsData.map((setting, index) => (
        <SettingItem
          key={index}
          title={setting.title}
          description={setting.description}
          lastItem={index === settingsData.length - 1}
          value={setting.value}
          toggleValue={setting.toggleValue}
        />
      ))}
    </section>
  );
};

export default SettingsContainer;
