"use client";

import MarkdownEditor from "@/components/MarkDownEditor";
import PageTitle from "@authorComponents/PageTitle";
import SectionWithTitle from "@authorComponents/ReusableSections/SectionWithTitle";
import { useState, type FC } from "react";

type StepProps = {
  number: number;
  active: boolean;
};

const Step: React.FC<StepProps> = ({ number, active }) => (
  <div
    className={`justify-center items-center p-3 w-8 h-8 text-base font-medium leading-6 whitespace-nowrap rounded-[56px] ${
      active
        ? "text-white bg-violet-600"
        : "text-gray-600 bg-white border border-gray-500"
    }`}
  >
    {number}
  </div>
);

type ButtonProps = {
  children: React.ReactNode;
  primary?: boolean;
};

const Button: React.FC<ButtonProps> = ({ children, primary }) => (
  <button
    className={`justify-center px-4 py-2 ${
      primary
        ? "text-white bg-violet-600 border-violet-600"
        : "text-violet-800 bg-violet-50 border-violet-100"
    } rounded-md border border-solid shadow-sm`}
  >
    {children}
  </button>
);

type FeedbackOptionProps = {
  title: string;
  description: string;
};

const FeedbackOption: React.FC<FeedbackOptionProps> = ({
  title,
  description,
}) => (
  <div className="flex flex-col flex-1">
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-center items-center px-1 my-auto w-4 h-4 bg-white border border-gray-400 border-solid rounded-[100px]">
        <div className="shrink-0 w-2 h-2 bg-white rounded-[524px]" />
      </div>
      <div className="text-lg font-semibold leading-7 text-black">{title}</div>
    </div>
    <div className="mt-1 text-base leading-6 text-gray-600 font-[450]">
      {description}
    </div>
  </div>
);

const MarkingPage: FC = () => {
  const [value, setValue] = useState("");
  return (
    // <div className="flex flex-col items-center pb-20 bg-gray-50">
    // 	<header className="flex flex-col self-stretch px-8 pt-7 w-full bg-white border border-b border-solid max-md:px-5">
    // 		<div className="flex gap-5 items-center w-full max-md:flex-wrap">
    // 			<img
    // 				loading="lazy"
    // 				alt=""
    // 				className="shrink-0 self-stretch max-w-full aspect-[2.86] w-[139px]"
    // 			/>
    // 			<h1 className="flex-auto self-stretch my-auto text-lg font-semibold leading-7 text-center text-gray-900">
    // 				Mark: Auto-Graded Assignment Creator
    // 			</h1>
    // 			<div className="flex gap-3.5 self-stretch my-auto text-base font-medium leading-6">
    // 				<Button>Publish</Button>
    // 				<Button primary>Save Draft</Button>
    // 			</div>
    // 		</div>
    // 		<nav className="flex z-10 gap-0 self-center mt-2.5 mb-0 max-w-full max-md:flex-wrap max-md:mb-2.5">
    // 			<Step number={1} active={false} />
    // 			<div className="flex flex-col flex-1 justify-center py-4">
    // 				<div className="shrink-0 h-px bg-gray-500 border border-gray-500 border-solid" />
    // 			</div>
    // 			<Step number={2} active={true} />
    // 			<div className="flex flex-col flex-1 justify-center py-4">
    // 				<div className="shrink-0 h-px bg-gray-500 border border-gray-500 border-solid" />
    // 			</div>
    // 			<Step number={3} active={false} />
    // 			<div className="flex flex-col flex-1 justify-center py-4">
    // 				<div className="shrink-0 h-px bg-gray-500 border border-gray-500 border-solid" />
    // 			</div>
    // 			<Step number={4} active={false} />
    // 		</nav>
    // 	</header>
    <main className="main-author-container">
      <PageTitle
        title="Give me instructions on how to mark this assignment!"
        description="Mark will use your instructions in this section to mark the assignment. Responses in this section will not be shown to learners."
      />
      <SectionWithTitle
        title="How much feedback should I give students?"
        description="Total score for the assignment cannot be excluded."
      >
        <MarkdownEditor
          value={value}
          setValue={setValue}
          placeholder="Click to type"
        />
      </SectionWithTitle>
      <SectionWithTitle
        title="How much feedback should I give students?"
        description={
          <>
            <span className="text-gray-600">
              Total score for the assignment cannot be excluded.{" "}
            </span>
            <button type="button" className="text-justify text-violet-600">
              Click here to get more fine-grain control.
            </button>
          </>
        }
      >
        <div className="flex gap-5 mt-4 max-md:flex-wrap">
          <FeedbackOption
            title="Full"
            description="Include correct or incorrect status, explanation, and relevant knowledge."
          />
          <FeedbackOption
            title="Partial"
            description="Only includes correct or incorrect status. Question points will not be shown."
          />
          <FeedbackOption
            title="Limited"
            description="No status or feedback provided at all. Question points will not be shown."
          />
        </div>
      </SectionWithTitle>
      <nav className="flex gap-5 justify-between max-w-full text-base font-medium leading-6 text-violet-800 whitespace-nowrap max-md:flex-wrap">
        <Button>Previous</Button>
        <Button>Next</Button>
      </nav>
    </main>
    // </div>
  );
};

export default MarkingPage;
