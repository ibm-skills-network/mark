import MarkdownEditor from "@/components/MarkDownEditor";
import Title from "@/components/Title";
import { GradingData } from "@/config/types";
import {
  ComponentPropsWithoutRef,
  ElementType,
  type Dispatch,
  type SetStateAction,
} from "react";
import { twMerge } from "tailwind-merge";
import GradingOptionsForm from "./GradingOptionsForm";
import {
  GradingIcon,
  InstructionIcon,
  IntroductionIcon,
} from "./IntroductionSvgs";

const titleToDescription = {
  Introduction:
    "Write a short summary of the learning goals of this assignment and what learners will be required to do",
  Instructions:
    "Write specific instructions for students to follow when submitting their assignment. Or remind them to follow a certain format before submitting",
  Grading:
    "Select the options that you want to apply to your assignment, you can come back and change these anytime",
  "Add Additional Files":
    "Add any additional files the student may need to interact with when taking the assignment",
} as const as Record<string, string>;

const titleToSvg = {
  Introduction: <IntroductionIcon />,
  Instructions: <InstructionIcon />,
  Grading: <GradingIcon />,
} as const as Record<string, JSX.Element>;
export function IntroductionSection<T extends ElementType = "section">({
  as,
  className,
  title,
  value,
  setValue,
  ...props
}: Omit<ComponentPropsWithoutRef<T>, "as" | "className"> & {
  as?: T;
  className?: string;
  title: string;
  value: unknown;
  setValue: Dispatch<SetStateAction<unknown>>;
  [key: string]: unknown;
}) {
  const Component = as ?? "section";
  const description = titleToDescription[title];
  const svg = titleToSvg[title];
  return (
    <Component
      className={twMerge("group relative flex flex-col items-start", className)}
      id={title.toLowerCase()}
      {...props}
    >
      <div className="flex items-center bg-gray-50 rounded-t-lg border-t border-l border-r border-gray-300 w-full min-h-[6.5rem] px-12 2xl:px-14">
        <div className="w-12 mr-6">{svg}</div>
        <div className="">
          <Title text={title} className="text-lg font-semibold leading-6" />
          <p className="mt-2 text-gray-500 ">{description}</p>
        </div>
      </div>
      <div className="w-full border rounded-b-lg border-gray-300 bg-white px-12 2xl:px-14 py-8">
        {title === "Introduction" || title === "Instructions" ? (
          <MarkdownEditor
            value={value as string}
            setValue={setValue}
            textareaClassName="!min-h-[6.5rem] !max-h-72"
            className=""
          />
        ) : (
          <GradingOptionsForm
            value={value as GradingData}
            setValue={setValue}
          />
        )}
      </div>
    </Component>
  );
}

export default IntroductionSection;
