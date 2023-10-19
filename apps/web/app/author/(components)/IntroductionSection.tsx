import MarkdownEditor from "@/components/MarkDownEditor";
import Title from "@/components/Title";
import { GradingData } from "@/config/types";
import {
  ComponentPropsWithoutRef,
  ElementType,
  useMemo,
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

const titleToDescription = [
  {
    sectionId: "introduction",
    title: "Short Summary of The Learning Goals",
    description:
      "Write a short summary of the learning goals of this assignment and what learners will be required to do",
    svg: <IntroductionIcon />,
  },
  {
    sectionId: "instructions",
    title: "Instructions for learners",
    description:
      "Write specific instructions for learners to follow when submitting their assignment. Or remind them to follow a certain format before submitting",
    svg: <InstructionIcon />,
  },
  {
    sectionId: "grading",
    title: "Grading",
    description:
      "Select the options that you want to apply to your assignment, you can come back and change these anytime",
    svg: <GradingIcon />,
  },
  {
    sectionId: "overview",
    title: "Grading Criteria Overview",
    description:
      "Provide a brief explanation on how the assignment will be graded",
    svg: <GradingIcon />,
  },
] as const;

export function IntroductionsectionId<T extends ElementType = "section">(
  props: Omit<ComponentPropsWithoutRef<T>, "as" | "className"> & {
    as?: T;
    className?: string;
    sectionId: string;
    value: unknown;
    setValue: Dispatch<SetStateAction<unknown>>;
    [key: string]: unknown;
  }
) {
  const { as, className, sectionId, value, setValue, ...rest } = props;
  const Component = as ?? "section";
  const section = useMemo(() => {
    return titleToDescription.find(
      (section) => section.sectionId === sectionId
    );
  }, [sectionId]);
  const { title, description, svg } = section;
  return (
    <Component
      className={twMerge("group relative flex flex-col items-start", className)}
      id={sectionId.toLowerCase()}
      {...rest}
    >
      <div className="flex items-center bg-gray-50 rounded-t-lg border-t border-l border-r border-gray-300 w-full min-h-[6.5rem] px-12 2xl:px-14">
        <div className="w-12 mr-6">{svg}</div>
        <div className="">
          <Title text={title} className="text-lg font-semibold leading-6" />
          <p className="mt-2 text-gray-500 ">{description}</p>
        </div>
      </div>
      <div className="w-full border rounded-b-lg border-gray-300 bg-white px-12 2xl:px-14 py-8">
        {sectionId === "introduction" ||
        sectionId === "instructions" ||
        sectionId === "overview" ? (
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

export default IntroductionsectionId;
