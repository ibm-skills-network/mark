"use client";

import React, { useState } from "react";

interface RubricTableProps {
  rubrics: any;
  onAddRow: () => void; // Define a prop for the add row functionality
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
            <table className="min-w-full divide-y divide-gray-300 border border-gray-300">
              <thead>
                <tr className="divide-x divide-gray-200">
                  <th
                    scope="col"
                    className="py-3.5 pl-4 pr-4 text-left text-sm font-semibold text-gray-900 sm:pl-0"
                  >
                    Criteria
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900"
                  >
                    Performance Descripiton
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900"
                  >
                    Point Range
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 pl-4 pr-4 text-left text-sm font-semibold text-gray-900 sm:pr-0"
                  >
                    Weight
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
                      className={`whitespace-nowrap py-4 pl-4 pr-4 text-sm font-medium ${
                        index === 0 ? "bg-gray-80" : ""
                      } sm:pl-0`}
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
                        Delete
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
