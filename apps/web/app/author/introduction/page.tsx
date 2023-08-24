"use client";

import MarkdownEditor from "@components/MarkDownEditor";
import React, { useEffect, useRef, useState } from "react";

const AuthorIntroduction = () => {
  const [introduction, setIntroduction] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isGraded, setIsGraded] = useState(true);
  const [selectedAttempt, setSelectedAttempt] = useState(1); // Default selected attempt is 1

  const [file, setFile] = useState();
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  ////////////////////////////////Implement the drag and drop for upload/////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////

  const [dragActive, setDragActive] = React.useState(false);
  // ref
  const inputRef = useRef<HTMLInputElement>(null);

  // handle drag events
  const handleDrag = (e: React.DragEvent<HTMLFormElement | HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // triggers when file is dropped
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      // handleFiles(e.dataTransfer.files);
    }
  };

  // triggers when file is selected with click
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      // handleFiles(e.target.files);
    }
  };

  // triggers the input when the button is clicked
  const onButtonClick = () => {
    inputRef.current.click();
  };

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////

  // this handles how many attempt the learner can take the assignment
  const handleAttemptChange = (event: React.MouseEvent<HTMLButtonElement>) => {
    const target = event.target as HTMLButtonElement;
    setSelectedAttempt(parseInt(target.value));
  };

  // this handles the introduction markdown input
  const handleIntroductionChange = (newValue: string) => {
    setIntroduction(newValue);
  };

  // this handles the instruction markdown input
  const handleInstructionChange = (newValue: string) => {
    setInstruction(newValue);
  };

  // this handles when user set this assignment to be practice/ungraded
  const handleUngradedChange = () => {
    setIsGraded(false); // Set isActive to true when the component is focused
  };

  // this handles when user set this assignment to be graded
  const handleGradedChange = () => {
    setIsGraded(true); // Set isActive to false when the component loses focus
  };

  return (
    <div>
      <div
        className={`flex flex-col border mt-8 pl-2 rounded-md p-4 bg-white ml-[100px]`}
        style={{
          minWidth: "67.5625rem",
          minHeight: "20.5rem",
          maxHeight: "50.5rem",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1"
          stroke="currentColor"
          className="w-6 h-6"
          style={{ transform: "translate(45px, 35px) scale(2.3)" }}
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>

        <div
          className=""
          style={{
            width: "57.5625rem",
            color: "#000000",
            fontSize: 19.17,

            transform: "translate(105px, -6px)", // Adjust the vertical value as needed
            textAlign: "left",
          }}
        >
          Introduction
        </div>

        <div
          className="text-gray-500 "
          style={{
            fontSize: 16.17,
            transform: "translate(105px, 1px)", // Adjust the vertical value as needed
          }}
        >
          Write a short summary of the learning goals of this assignment and
          what learners will be required to do
        </div>

        <div className="w-[1095px] h-[104px] bg-gray-50 rounded-tl-xl rounded-tr-xl border -ml-[10px] -mt-[95px] border-gray-300" />
        <div>
          <MarkdownEditor
            style={{ height: "150px" }}
            value={introduction}
            onChange={handleIntroductionChange}
          />
        </div>
      </div>

      <div
        className={`flex flex-col border mt-8 pl-2 rounded-md p-4 bg-white ml-[100px]`}
        style={{
          minWidth: "67.5625rem",
          minHeight: "20.5rem",
          maxHeight: "50.5rem",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1"
          stroke="currentColor"
          className="w-6 h-6"
          style={{ transform: "translate(45px, 35px) scale(2.3)" }}
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>

        <div
          className=""
          style={{
            width: "57.5625rem",
            color: "#000000",
            fontSize: 19.17,

            transform: "translate(105px, -6px)", // Adjust the vertical value as needed
            textAlign: "left",
          }}
        >
          Instruction
        </div>

        <div
          className="text-gray-500 "
          style={{
            fontSize: 16.17,
            transform: "translate(105px, 1px)", // Adjust the vertical value as needed
          }}
        >
          Write a short summary of the learning goals of this assignment and
          what learners will be required to do
        </div>

        <div className="w-[1082px] h-[104px] bg-gray-50 rounded-tl-xl rounded-tr-xl border -mt-20 border-gray-300" />
        <div>
          <MarkdownEditor
            style={{ height: "150px" }}
            value={instruction}
            onChange={handleInstructionChange}
          />
        </div>
      </div>

      <div
        className={`flex flex-col border mt-8 pl-2 rounded-md p-4 bg-white ml-[100px]`}
        style={{
          minWidth: "67.5625rem",
          minHeight: "20.5rem",
          maxHeight: "50.5rem",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1"
          stroke="currentColor"
          className="w-6 h-6"
          style={{ transform: "translate(45px, 35px) scale(2.3)" }}
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M10.125 2.25h.375a9 9 0 019 9v.375M10.125 2.25A3.375 3.375 0 0113.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 013.375 3.375M9 15l2.25 2.25L15 12"
          />
        </svg>

        <div
          style={{
            width: "57.5625rem",
            color: "#000000",
            fontSize: 19.17,
            transform: "translate(105px, -6px)", // Adjust the vertical value as needed
            textAlign: "left",
          }}
        >
          Grading
        </div>

        <div
          className="text-gray-500"
          style={{
            fontSize: 16.17,
            transform: "translate(105px, 1px)", // Adjust the vertical value as needed
          }}
        >
          Write a short summary of the learning goals of this assignment and
          what learners will be required to do
        </div>

        <div className="w-[1082px] h-[104px] bg-gray-50 rounded-tl-xl rounded-tr-xl border -mt-20 border-gray-300" />

        <div>
          <div>
            <input
              className="ml-40"
              type="radio"
              id="graded"
              name="gradingOption"
              value="graded"
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
              onChange={handleUngradedChange}
            />
            <label htmlFor="ungraded" className="ml-12">
              Practice or Ungraded
            </label>
          </div>

          <div className="flex items-center">
            <textarea
              className="border w-42 h-14 p-2"
              placeholder="Textarea 1"
            />

            <button
              className="bg-white border text-black p-2 rounded-md"
              onClick={handleAttemptChange}
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
      </div>

      <div
        className={`flex flex-col border mt-8 pl-2 rounded-md p-4 bg-white ml-[100px]`}
        style={{
          width: "68.5625rem",
          minHeight: "20.5rem",
          maxHeight: "50.5rem",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1"
          stroke="currentColor"
          className="w-6 h-6"
          style={{ transform: "translate(45px, 35px) scale(2.3)" }}
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>

        <div
          style={{
            width: "68.5625rem",
            color: "#000000",
            fontSize: 19.17,
            transform: "translate(105px, -6px)", // Adjust the vertical value as needed
            textAlign: "left",
          }}
        >
          Add Addititonal Files
        </div>

        <div
          className="text-gray-500"
          style={{
            fontSize: 16.17,
            transform: "translate(105px, 1px)", // Adjust the vertical value as needed
          }}
        >
          Drag and drop any files the student may need to interact
        </div>

        <div className="w-[1095px] h-[104px] bg-gray-50 rounded-tl-xl rounded-tr-xl border -ml-[10px] -mt-[95px] border-gray-300" />

        <form
          id="form-file-upload"
          onDragEnter={handleDrag}
          onSubmit={(e) => e.preventDefault()}
        >
          <input
            className="ml-96 mt-16"
            ref={inputRef}
            type="file"
            id="input-file-upload"
            multiple={true}
            onChange={handleChange}
          />
          <label
            id="label-file-upload"
            htmlFor="input-file-upload"
            className={dragActive ? "drag-active" : ""}
          >
            <div>
              <button
                className="upload-button ml-96 mt-2"
                onClick={onButtonClick}
              >
                Upload a file here or
              </button>
              <p className="ml-[543px] -mt-6">drag and drop</p>
            </div>
          </label>
          {dragActive && (
            <div
              id="drag-file-element"
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            ></div>
          )}
        </form>
      </div>
    </div>
  );
};

export default AuthorIntroduction;
