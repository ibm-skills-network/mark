import type { GradingData } from "@config/types";
import { type Dispatch, type SetStateAction } from "react";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  value: GradingData;
  setValue: Dispatch<SetStateAction<GradingData>>;
}

function GradingOptionsForm(props: Props) {
  const { value, setValue } = props;

  const { isGraded, attempts, passingGrade, timeEstimate } = value;

  function handleGradedChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      isGraded: e.target.checked,
    }));
  }

  function handleAttemptChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      attempts: parseInt(e.target.value),
    }));
  }

  function handlePassingGradeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      passingGrade: parseInt(e.target.value),
    }));
  }

  function handleTimeEstimateChange(e: React.ChangeEvent<HTMLInputElement>) {
    // e.preventDefault();
    setValue((prevValue) => ({
      ...prevValue,
      timeEstimate: parseInt(e.target.value),
    }));
  }

  return (
    <div className="grid grid-cols-2">
      <div>
        <input
          className="ml-40"
          type="radio"
          name="gradingOption"
          checked={isGraded}
          onChange={handleGradedChange}
        />
        <label htmlFor="graded center" className="ml-12">
          Graded Assignment
        </label>

        <input
          className="ml-40"
          type="radio"
          id="ungraded"
          name="gradingOption"
          value="ungraded"
          checked={!isGraded}
          onChange={handleGradedChange}
        />
        <label htmlFor="ungraded" className="ml-12">
          Practice or Ungraded
        </label>
      </div>

      <div className="flex items-center">
        <textarea className="border w-42 h-14 p-2" placeholder="Textarea 1" />

        <button
          className="bg-white border text-black p-2 rounded-md"
          // onClick={handleAttemptChange}
          style={{
            width: "19.125rem",
            height: "3.5rem",
          }}
        >
          <span style={{ marginLeft: "10px" }}>{"Attempts"}</span>
        </button>

        <button
          id="dropdownDividerButton"
          data-dropdown-toggle="dropdownDivider"
          className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          type="button"
        >
          Attempts{" "}
          <svg
            className="w-2.5 h-2.5 ml-2.5"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 10 6"
          >
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="m1 1 4 4 4-4"
            />
          </svg>
        </button>

        <div
          id="dropdownDivider"
          className="z-10 hidden bg-white divide-y divide-gray-100 rounded-lg shadow w-44 dark:bg-gray-700 dark:divide-gray-600"
        >
          <ul
            className="py-2 text-sm text-gray-700 dark:text-gray-200"
            aria-labelledby="dropdownDividerButton"
          >
            <li>
              <a
                href="#"
                className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Dashboard
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Settings
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Earnings
              </a>
            </li>
          </ul>
          <div className="py-2">
            <a
              href="#"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-200 dark:hover:text-white"
            >
              Separated link
            </a>
          </div>
        </div>
      </div>

      <textarea className="border w-42 h-14 p-2" placeholder="Textarea 3" />
    </div>
  );
}

export default GradingOptionsForm;
