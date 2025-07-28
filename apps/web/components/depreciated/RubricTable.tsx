"use client";

import { useState } from "react";

interface RubricTableProps {
  rubrics: any;
  onAddRow: () => void;
  onDeleteRow: (index: number) => void;
  setRubrics: any;
}

function RubricTableProps(props: RubricTableProps) {
  const { rubrics, onAddRow, onDeleteRow, setRubrics } = props;

  const [inputEnabled, setInputEnabled] = useState(false);

  const handleButtonClick = (value: boolean) => {
    setInputEnabled(value);
  };
  //////////////////////////////////////////////////

  return (
    <div className="w-[802px]">
      {" "}
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-base font-semibold leading-6 text-gray-900 relative">
            Point Distributon for the Rubric
            <span className="absolute -top-1 left-38 text-purple-400">*</span>
          </h1>
        </div>
      </div>
      <div className="mt-8 flex">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table
              className="min-w-full divide-y divide-gray-300 border border-gray-700"
              style={{
                overflow: "hidden",
                borderCollapse: "collapse",
                borderRadius: "10px",
              }}
            >
              <thead>
                <tr className="divide-x divide-gray-200">
                  <th
                    scope="col"
                    className="py-3.5 pl-4 pr-4 h-[2.75rem] text-left text-sm font-semibold bg-gray-100 text-gray-900 sm:pl-0"
                  >
                    <div className="flex items-center font-normal ml-8 text-0.5xl">
                      {" "}
                      Criteria
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 h-[1.25rem] text-left text-sm font-semibold text-gray-900"
                  >
                    <div className="flex items-center font-normal ml-2 text-0.5xl">
                      {" "}
                      Performance Descripiton
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 h-[2.75rem]  text-left text-sm font-semibold text-gray-900"
                  >
                    <div className="flex items-center font-normal ml-1">
                      {" "}
                      Point Range
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 pl-4 pr-4 text-left text-sm font-semibold text-gray-900 sm:pr-0"
                  >
                    <div className="flex items-center font-normal text-0.5xl">
                      {" "}
                      Weight (%)
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rubrics.map((rubric, index) => (
                  <tr key={rubric.key} className="divide-x divide-gray-200">
                    <td className="h-[12.0625rem] py-4 pl-4 pr-4 text-sm font-medium bg-gray-100 sm:pl-0">
                      <td className="h-[12.0625rem] py-4 pl-4 pr-4 text-sm font-medium bg-gray-100 sm:pl-0">
                        <input
                          type="text"
                          className="w-full h-full border-transparent bg-gray-100 hover:bg-gray-300 text-sm placeholder-gray-400 hover:placeholder-white focus:outline-none focus:bg-gray-300 focus:placeholder-gray-600"
                          placeholder="Describe the key elements of a project charter."
                          style={{ overflowWrap: "break-word" }}
                          value={rubrics[index].criteria}
                          onChange={(event) => {
                            const newRubrics = [...rubrics];
                            newRubrics[index].criteria = event.target.value;
                            setRubrics(newRubrics);
                          }}
                        />
                      </td>
                    </td>
                    <td className=" p-4 text-sm text-gray-500 ">
                      <td
                        className={
                          " h-[12.0625rem] py-4 pl-4 pr-4 text-sm font-medium  sm:pl-0"
                        }
                      >
                        <textarea
                          className="w-[100%] h-[100%] border-transparent text-xs break-normal  hover:bg-gray-300 "
                          placeholder="Expands and Mentions any key elements such as; Project Purpose, Project Scope, Project Timeline, Project TeamThe student must explain each section with considerable amount of detail."
                          value={rubrics[index].judgement}
                          onChange={(event) => {
                            const newRubrics = [...rubrics];
                            newRubrics[index].judgement = event.target.value;
                            setRubrics(newRubrics);
                          }}
                        />
                      </td>
                    </td>
                    <td className="whitespace-nowrap p-4 text-sm text-gray-500 flex">
                      <div className="flex items-center">
                        <td
                          className={
                            "whitespace-nowrap  h-[12.0625rem] py-4 pl-4 pr-4 text-sm font-medium  sm:pl-0 flex"
                          }
                        >
                          <input
                            type="text"
                            className="w-[100%] h-[40%] items-center justify-center border-transparent ${
                              inputEnabled ? 'bg-gray-300' : 'bg-white'
                            } "
                            value={rubrics[index].rate}
                            onChange={(event) => {
                              const newRubrics = [...rubrics];
                              newRubrics[index].rate = event.target.value;
                              setRubrics(newRubrics);
                            }}
                            disabled={!inputEnabled}
                            onBlur={() => handleButtonClick(false)}
                          />
                        </td>
                        <button onClick={() => handleButtonClick(true)}>
                          <svg
                            className="mr-[40px]"
                            xmlns="http://www.w3.org/2000/svg"
                            width="19"
                            height="18"
                            viewBox="0 0 19 18"
                            fill="none"
                          >
                            <path
                              d="M13.8816 2.77258L15.2875 1.36591C15.5805 1.07284 15.978 0.908203 16.3925 0.908203C16.8069 0.908203 17.2044 1.07284 17.4975 1.36591C17.7905 1.65897 17.9552 2.05645 17.9552 2.47091C17.9552 2.88536 17.7905 3.28285 17.4975 3.57591L5.52329 15.5501C5.08273 15.9904 4.53943 16.314 3.94246 16.4917L1.70496 17.1584L2.37162 14.9209C2.54935 14.3239 2.87298 13.7806 3.31329 13.3401L13.8825 2.77258H13.8816ZM13.8816 2.77258L16.08 4.97091"
                              stroke="#1D4ED8"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-4 text-sm text-gray-500">
                      <div className="flex items-center">
                        <td
                          className={
                            "whitespace-nowrap  py-4 pl-4 pr-4 text-sm font-medium  sm:pl-0"
                          }
                        >
                          <input
                            type="number"
                            className=" h-[100%] border-transparent  ${
                              inputEnabled ? 'bg-gray-300' : 'bg-white'
                            } "
                            value={rubrics[index].weight}
                            onChange={(event) => {
                              const newRubrics = [...rubrics];
                              newRubrics[index].weight = event.target.value;
                              setRubrics(newRubrics);
                            }}
                            disabled={!inputEnabled}
                            onBlur={() => handleButtonClick(false)}
                            min={0}
                            max={10}
                            step={1}
                          />
                        </td>
                        <button onClick={() => handleButtonClick(true)}>
                          <svg
                            className="mr-[20px]"
                            xmlns="http://www.w3.org/2000/svg"
                            width="19"
                            height="18"
                            viewBox="0 0 19 18"
                            fill="none"
                          >
                            <path
                              d="M13.8816 2.77258L15.2875 1.36591C15.5805 1.07284 15.978 0.908203 16.3925 0.908203C16.8069 0.908203 17.2044 1.07284 17.4975 1.36591C17.7905 1.65897 17.9552 2.05645 17.9552 2.47091C17.9552 2.88536 17.7905 3.28285 17.4975 3.57591L5.52329 15.5501C5.08273 15.9904 4.53943 16.314 3.94246 16.4917L1.70496 17.1584L2.37162 14.9209C2.54935 14.3239 2.87298 13.7806 3.31329 13.3401L13.8825 2.77258H13.8816ZM13.8816 2.77258L16.08 4.97091"
                              stroke="#1D4ED8"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-4 pl-4 pr-4 text-sm text-red-500">
                      <button
                        type="button"
                        onClick={() => onDeleteRow(index)}
                        className="text-red-500"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke-width="1.5"
                          stroke="currentColor"
                          className="w-6 h-6"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
            <button
              type="button"
              className="block h-[2.5rem] rounded-md bg-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-500 shadow-sm hover:bg-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              onClick={onAddRow}
            >
              Add Criteria
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RubricTableProps;
