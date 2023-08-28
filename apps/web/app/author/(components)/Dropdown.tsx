"use client";

import { Listbox, Menu, RadioGroup, Transition } from "@headlessui/react";
import {
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  ViewListIcon,
} from "@heroicons/react/solid";
import React, { Fragment, useEffect, useRef, useState } from "react";

interface DropdownProps {
  answerTypeSelected: any; // Replace 'any' with the appropriate type
  setAnswerTypeSelected: (selected: any) => void; // Replace 'any' with the appropriate type
  answerTypes: any;
}

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

function Dropdown(props: DropdownProps) {
  const { answerTypeSelected, setAnswerTypeSelected, answerTypes } = props;
  return (
    <Listbox value={answerTypeSelected} onChange={setAnswerTypeSelected}>
      {({ open }) => (
        <>
          <Listbox.Label className="sr-only">
            Change published status
          </Listbox.Label>
          <div className="relative">
            <div className="inline-flex divide-x divide-indigo-700 rounded-md shadow-sm">
              <div className="inline-flex items-center gap-x-1.5 rounded-l-md bg-indigo-600 px-3 py-2 text-white shadow-sm">
                <CheckIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
                <p className="text-sm font-semibold">
                  {answerTypeSelected.title}
                </p>
              </div>
              <Listbox.Button className="inline-flex items-center rounded-l-none rounded-r-md bg-indigo-600 p-2 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 focus:ring-offset-gray-50">
                <span className="sr-only">Change published status</span>
                <ChevronDownIcon
                  className="h-5 w-5 text-white"
                  aria-hidden="true"
                />
              </Listbox.Button>
            </div>

            <Transition
              show={open}
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute right-0 z-10 mt-2 w-72 origin-top-right divide-y divide-gray-200 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                {answerTypes.map((option, index) => (
                  <Listbox.Option
                    key={option.title}
                    className={({ active }) =>
                      classNames(
                        active ? "bg-indigo-600 text-white" : "text-gray-900",
                        "cursor-default select-none p-4 text-sm"
                      )
                    }
                    value={option}
                  >
                    {({ selected, active }) => (
                      <div className="flex flex-col">
                        <div className="flex justify-between items-center">
                          {index === 0 ? ( // Use CashIcon for the first option
                            <CheckCircleIcon
                              className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500"
                              aria-hidden="true"
                            />
                          ) : index === 1 ? ( // Use CheckIcon for the second option
                            <ViewListIcon
                              className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500"
                              aria-hidden="true"
                            />
                          ) : index === 2 ? ( // Use ChevronDownIcon for the third option
                            <PencilIcon
                              className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500"
                              aria-hidden="true"
                            />
                          ) : null}
                          <p
                            className={
                              selected ? "font-semibold" : "font-normal"
                            }
                          >
                            {option.title}
                          </p>
                          {selected ? (
                            <span
                              className={
                                active ? "text-white" : "text-indigo-600"
                              }
                            >
                              <CheckIcon
                                className="h-5 w-5"
                                aria-hidden="true"
                              />
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={classNames(
                            active ? "text-indigo-200" : "text-gray-500",
                            "mt-2"
                          )}
                        >
                          {option.description}
                        </p>
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </>
      )}
    </Listbox>
  );
}

export default Dropdown;
