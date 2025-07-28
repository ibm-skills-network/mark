import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  type?: "positive" | "neutral" | "negative";
}

export function FeedbackMessage(props: Props) {
  const { type = "positive" } = props;
  let feedbackText = "";
  let bgColor = "";
  let borderColor = "";
  let textColor = "";
  let innerCircleColor = "";

  switch (type) {
    case "positive":
      feedbackText = "Correct! Well done.";
      bgColor = "bg-emerald-100";
      borderColor = "border-emerald-500";
      textColor = "text-emerald-800";
      innerCircleColor = "bg-emerald-400";
      break;
    case "neutral":
      feedbackText = "Not all correct answers were selected.";
      bgColor = "bg-yellow-100";
      borderColor = "border-yellow-500";
      textColor = "text-yellow-800";
      innerCircleColor = "bg-yellow-400";
      break;
    case "negative":
      feedbackText = "Incorrect choice.";
      bgColor = "bg-red-100";
      borderColor = "border-red-500";
      textColor = "text-red-800";
      innerCircleColor = "bg-red-400";
      break;
    default:
      return null;
  }

  return (
    <div
      className={`w-96 h-16 pl-2 pr-2.5 py-0.5 ${bgColor} rounded-lg ${borderColor} justify-center items-center gap-1.5 inline-flex`}
    >
      <div className="w-2 h-2 relative">
        <div
          className={`w-1.5 h-1.5 left-[1px] top-[1px] absolute ${innerCircleColor} rounded-full`}
        />
      </div>
      <div
        className={`text-center ${textColor} text-base font-medium leading-negative`}
      >
        {feedbackText}
      </div>
    </div>
  );
}
