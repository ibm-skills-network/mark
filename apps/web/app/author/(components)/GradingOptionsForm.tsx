import type { GradingData } from "@config/types";
import { type Dispatch, type SetStateAction } from "react";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  value: GradingData;
  setValue: Dispatch<SetStateAction<GradingData>>;
}

function GradingOptionsForm(props: Props) {
  const { value, setValue } = props;

  const { graded, attempts, passingGrade, timeEstimate } = value;

  function handleGradedChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      graded: e.target.value === "graded",
    }));
  }

  function handleAttemptChange(e: React.ChangeEvent<HTMLSelectElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      attempts: ~~e.target.value,
    }));
  }

  function handlePassingGradeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      passingGrade: ~~e.target.value,
    }));
  }

  function handleTimeEstimateChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      timeEstimate: ~~e.target.value,
    }));
  }

  return (
    <div className="grid grid-cols-2 gap-x-16 gap-y-7">
      <div className="flex items-start gap-x-3 mb-3">
        <input
          className="text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-600 h-[1.375rem] w-[1.375rem]"
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
          className="text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-600 h-[1.375rem] w-[1.375rem]"
          type="radio"
          name="ungraded"
          value="ungraded"
          checked={!graded}
          onChange={handleGradedChange}
        />
        <div className="space-y-2">
          <label htmlFor="ungraded" className="font-medium leading-5">
            Practice or Ungraded
          </label>
          <p className="text-gray-500 text-sm">
            This assignment will not count towards the grade total for the
            student in the course.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="passingGrade" className="font-medium leading-5">
          <span className="text-gray-800">Time Estimate</span>{" "}
          <span className="text-gray-500">(minutes)</span>
        </label>
        <input
          type="number"
          className="border border-gray-300 rounded-md h-12 p-4 w-full"
          placeholder="ex. 60"
          onChange={handleTimeEstimateChange}
          value={timeEstimate}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="attempts" className="font-medium leading-5">
          <span className="text-gray-800">Attempts Allowed</span>
        </label>
        <select
          className="border border-gray-300 rounded-md h-12 px-4 w-full"
          name="attempts"
          id="attempts"
          onChange={handleAttemptChange}
          value={attempts}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
          <option value={5}>5</option>
          <option value={-1}>unlimited</option>
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="passingGrade" className="font-medium leading-5">
          <span className="text-gray-800">Passing Grade</span>{" "}
          <span className="text-gray-500">(%)</span>
        </label>
        <input
          type="number"
          className="border border-gray-300 rounded-md h-12 p-4 w-full"
          placeholder="ex. 50"
          onChange={handlePassingGradeChange}
          value={passingGrade}
        />
      </div>
    </div>
  );
}

export default GradingOptionsForm;
