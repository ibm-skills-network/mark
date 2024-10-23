"use client";
import {
  type ComponentPropsWithoutRef,
  type FC,
  type ButtonHTMLAttributes,
  useEffect,
} from "react";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";
import { stepTwoSections } from "@/config/constants";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { cn } from "@/lib/strings";
import type { VerbosityLevels } from "@/config/types";
import SettingsContainer from "./FeedbackSettings";

interface FeedbackOptionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  id: VerbosityLevels;
  title: string;
}

const FeedbackOption: React.FC<FeedbackOptionProps> = ({
  id,
  title,
  onClick,
  className,
}) => {
  const currentOption = useAssignmentFeedbackConfig(
    (state) => state.verbosityLevel,
  );
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "transition-colors flex flex-1 gap-1.5 px-6 py-4 rounded-md border border-solid justify-start focus:outline-none",
        currentOption === id &&
          "bg-violet-50 border-violet-100 text-violet-800",
        currentOption !== id && "border-gray-200 hover:bg-gray-50",
        className,
      )}
    >
      <div className="flex gap-1.5">
        <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-full">
          <div
            className={cn(
              "w-2.5 h-2.5 rounded-full",
              currentOption === id && "bg-violet-600",
            )}
          />
        </div>
        <div className="">{title}</div>
      </div>
    </button>
  );
};

interface Props extends ComponentPropsWithoutRef<"div"> {}

const Component: FC<Props> = () => {
  const [
    verbosityLevel,
    setVerbosityLevel,
    setShowAssignmentScore,
    setShowSubmissionFeedback,
    setShowQuestionScore,
  ] = useAssignmentFeedbackConfig((state) => [
    state.verbosityLevel,
    state.setVerbosityLevel,
    state.setShowAssignmentScore,
    state.setShowSubmissionFeedback,
    state.setShowQuestionScore,
  ]);
  const [showAssignmentScore, showSubmissionFeedback, showQuestionScore] =
    useAssignmentFeedbackConfig((state) => [
      state.showAssignmentScore,
      state.showSubmissionFeedback,
      state.showQuestionScore,
    ]);
  const handleButtonClick = (verbosity: VerbosityLevels) => {
    setVerbosityLevel(verbosity);
    switch (verbosity) {
      case "Full":
        setShowAssignmentScore(true);
        setShowSubmissionFeedback(true);
        setShowQuestionScore(true);
        break;
      case "Partial":
        setShowAssignmentScore(true);
        setShowSubmissionFeedback(false);
        setShowQuestionScore(true);
        break;
      case "None":
        setShowAssignmentScore(false);
        setShowSubmissionFeedback(false);
        setShowQuestionScore(false);
        break;
      default:
        break;
    }
  };
  useEffect(() => {
    if (showAssignmentScore && showSubmissionFeedback && showQuestionScore) {
      setVerbosityLevel("Full");
    } else if (
      !showAssignmentScore &&
      !showSubmissionFeedback &&
      !showQuestionScore
    ) {
      setVerbosityLevel("None");
    } else {
      setVerbosityLevel("Custom");
    }
  }, [showAssignmentScore, showSubmissionFeedback, showQuestionScore]);

  return (
    <SectionWithTitle
      title={stepTwoSections.feedback.title}
      description={stepTwoSections.feedback.description}
      className="flex flex-col gap-y-6 justify-evenly"
      required
    >
      <div className="flex gap-x-4 max-md:flex-wrap">
        <FeedbackOption
          id="Full"
          title="Full Feedback"
          onClick={() => handleButtonClick("Full")}
        />
        <FeedbackOption
          id="Custom"
          title="Custom"
          onClick={() => handleButtonClick("Custom")}
        />
        <FeedbackOption
          id="None"
          title="No Feedback"
          onClick={() => handleButtonClick("None")}
        />
      </div>
      <SettingsContainer />
    </SectionWithTitle>
  );
};

export default Component;
