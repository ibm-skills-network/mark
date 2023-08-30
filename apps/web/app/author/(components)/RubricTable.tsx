"use client";

import React, { useState } from "react";

interface RubricTableProps {
  rubrics: any;
  onAddRow: () => void;
  onDeleteRow: (index: number) => void;
}

function RubricTableProps(props: RubricTableProps) {
  const { rubrics, onAddRow, onDeleteRow } = props;

  return (
    <div>
      {" "}
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-base font-semibold leading-6 text-gray-900 relative">
            Point Distributon for the Rubric
            <span className="absolute -top-1 left-38 text-blue-400">*</span>
          </h1>
        </div>

        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <button
            type="button"
            className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            onClick={onAddRow}
          >
            Add row
          </button>
        </div>
      </div>
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table
              className="min-w-full divide-y divide-gray-300 border border-gray-300"
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
                    className="py-3.5 pl-4 pr-4 w-[19.70812rem] h-[2.75rem] text-left text-sm font-semibold bg-gray-100 text-gray-900 sm:pl-0"
                  >
                    <div className="flex items-center text-xs font-normal ml-8 text-0.5xl">
                      {" "}
                      {/* Adding ml-2 to move the text */}
                      Criteria
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 w-[22.5rem] h-[1.25rem] text-left text-sm font-semibold text-gray-900"
                  >
                    <div className="flex items-center text-xs font-normal ml-2 text-0.5xl">
                      {" "}
                      {/* Adding ml-2 to move the text */}
                      Performance Descripiton
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 w-[8.2rem] h-[2.75rem]  text-left text-sm font-semibold text-gray-900"
                  >
                    <div className="flex items-center text-xs font-normal ml-1">
                      {" "}
                      {/* Adding ml-2 to move the text */}
                      Point Range
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 pl-4 pr-4 text-left text-sm font-semibold text-gray-900 sm:pr-0"
                  >
                    <div className="flex items-center text-xs font-normal text-0.5xl">
                      {" "}
                      {/* Adding ml-2 to move the text */}
                      Weight
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rubrics.map((rubric, index) => (
                  <tr
                    key={rubric.criteria}
                    className="divide-x divide-gray-200"
                  >
                    <td
                      className={`whitespace-nowrap py-4 pl-4 pr-4 text-sm font-medium bg-gray-100 sm:pl-0`}
                    >
                      {rubric.criteria}
                    </td>
                    <td className="whitespace-nowrap p-4 text-sm text-gray-500">
                      {rubric.judgement}
                    </td>
                    <td className="whitespace-nowrap p-4 text-sm text-gray-500">
                      {rubric.rate}
                    </td>
                    <td className="whitespace-nowrap py-4 pl-4 pr-4 text-sm text-gray-500 sm:pr-0">
                      {rubric.weight}
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
        </div>
      </div>
    </div>
  );
}

export default RubricTableProps;
