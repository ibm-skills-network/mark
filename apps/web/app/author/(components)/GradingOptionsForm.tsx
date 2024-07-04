import Tooltip from "@/components/Tooltip";
import { useAssignmentDetails } from "@/stores/learner";
import type { GradingData } from "@config/types";
import { QuestionMarkCircleIcon } from "@heroicons/react/24/solid";
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  Dispatch,
  SetStateAction,
} from "react";
import TimeLimitInputDropdown from "./TimeLimitInputDropdown";

interface Props extends ComponentPropsWithoutRef<"div"> {
  value: GradingData;
  setValue: Dispatch<SetStateAction<GradingData>>;
}

function GradingOptionsForm(props: Props) {
  const { value, setValue } = props;

  const {
    graded,
    numAttempts,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
  } = value;
  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  function handleGradedChange(e: ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      graded: e.target.value === "graded",
    }));
  }

  function handleAttemptChange(e: ChangeEvent<HTMLSelectElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      numAttempts: ~~e.target.value,
    }));
  }

  function handleQuestionRetryChange(e: ChangeEvent<HTMLSelectElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      questionRetries: ~~e.target.value,
    }));
    localStorage.setItem(
      `${assignmentId}-defaultQuestionRetries`,
      e.target.value
    );
  }

  function handlePassingGradeChange(e: ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      passingGrade: ~~e.target.value,
    }));
  }

  function handleTimeEstimateChange(e: ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      timeEstimateMinutes: ~~e.target.value || null,
    }));
  }

  function setAllotedTimeMinutes(minutes: number | null) {
    setValue((prevValue) => ({
      ...prevValue,
      allotedTimeMinutes: minutes || null,
    }));
  }
  function handleAllotedTimeChange(e: ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    console.log(e.target.value);
    setAllotedTimeMinutes(~~e.target.value || null);
  }

  return (
    <div className="grid grid-cols-2 gap-x-16 gap-y-7">
      <div className="flex items-start gap-x-3 mb-3">
        <input
          className="text-blue-600 outline-none focus:ring-2 focus:ring-blue-600 h-[1.375rem] w-[1.375rem]"
          type="radio"
          name="graded"
          value="graded"
          checked={graded}
          onChange={handleGradedChange}
        />
        <div className="space-y-2">
          <label htmlFor="graded" className="font-medium leading-5">
            Graded Assignment
          </label>
          <p className="text-gray-500">
            This assignment&apos;s score directly impacts the student&apos;s
            overall course grade.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-x-3 mb-3">
        <input
          className="text-blue-600 outline-none focus:ring-2 focus:ring-blue-600 h-[1.375rem] w-[1.375rem]"
          type="radio"
          name="ungraded"
          value="ungraded"
          checked={!graded}
          onChange={handleGradedChange}
        />
        <div className="space-y-2">
          <label
            htmlFor="ungraded"
            className="font-medium leading-5 items-center"
          >
            Practice or Ungraded Assignment
          </label>
          <p className="text-gray-500">
            This assignment will not count towards the grade total for the
            student in the course.
          </p>
        </div>
      </div>

      {/* a border that has a corner that thins out */}
      <div className="col-span-2 h-0.5 bg-gradient-to-r from-transparent via-gray-300 via-50%" />

      <div className="flex flex-col gap-y-2">
        <label
          htmlFor="passingGrade"
          className="font-medium leading-5 flex gap-x-1"
        >
          Time Limit
          <span className="text-gray-500 font-normal">(minutes)</span>
          <Tooltip content="The amount of time a student has to complete this assignment.">
            <QuestionMarkCircleIcon className="w-5 inline-block text-blue-500" />
          </Tooltip>
        </label>
        <TimeLimitInputDropdown
          value={allotedTimeMinutes}
          setAllotedTimeMinutes={setAllotedTimeMinutes}
        />
      </div>

      <div className="flex flex-col gap-y-2">
        <label
          htmlFor="passingGrade"
          className="font-medium leading-5 flex gap-x-1"
        >
          Time Estimate
          <span className="text-gray-500 font-normal">(minutes)</span>
          <Tooltip content="The amount of time you think it will take a student to complete this assignment.">
            <QuestionMarkCircleIcon className="w-5 inline-block text-blue-500" />
          </Tooltip>
        </label>
        <input
          type="number"
          className="border border-gray-300 rounded-md h-12 p-4 w-full"
          placeholder="ex. 60"
          min={0}
          step={5}
          onChange={handleTimeEstimateChange}
          value={timeEstimateMinutes}
        />
      </div>

      <div className="flex flex-col gap-y-2">
        <label
          htmlFor="attempts"
          className="font-medium leading-5 flex gap-x-1"
        >
          Assignment Submissions Allowed
          <Tooltip content="The number of times a student can submit this assignment.">
            <QuestionMarkCircleIcon className="w-5 inline-block text-blue-500" />
          </Tooltip>
        </label>
        <select
          className="border border-gray-300 rounded-md h-12 px-4 w-full"
          name="attempts"
          id="attempts"
          onChange={handleAttemptChange}
          value={numAttempts || -1}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
          <option value={5}>5</option>
          <option value={-1}>unlimited</option>
        </select>
      </div>

      <div className="flex flex-col gap-y-2">
        <label
          htmlFor="attempts"
          className="font-medium leading-5 flex gap-x-1"
        >
          Default Attempts for Each Question
          <Tooltip content="The default number of times a student can retry each question in one submission">
            <QuestionMarkCircleIcon className="w-5 inline-block text-blue-500" />
          </Tooltip>
        </label>
        <select
          className="border border-gray-300 rounded-md h-12 px-4 w-full"
          name="attempts"
          id="attempts"
          onChange={handleQuestionRetryChange}
          value={value.questionRetries || -1}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
          <option value={5}>5</option>
          <option value={-1}>unlimited</option>
        </select>
      </div>

      <div className="flex flex-col gap-y-2">
        <label
          htmlFor="passingGrade"
          className="font-medium leading-5 flex gap-x-1 after:text-blue-400 after:content-['*']"
        >
          Passing Grade
          <span className="text-gray-500">(%)</span>
        </label>
        <input
          type="number"
          className="border border-gray-300 rounded-md h-12 p-4 w-full"
          placeholder="ex. 50"
          min={0}
          step={5}
          onChange={handlePassingGradeChange}
          value={passingGrade}
        />
      </div>
    </div>
  );
}

export default GradingOptionsForm;
