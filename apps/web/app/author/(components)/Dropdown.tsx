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
    <div className="w-[19.125rem]">
      <Listbox
        className="w-[19.125rem]"
        value={answerTypeSelected}
        onChange={setAnswerTypeSelected}
      >
        {({ open }) => (
          <>
            <Listbox.Label className="sr-only">
              Change published status
            </Listbox.Label>
            <div className="relative">
              <div className="w-[19.125rem] h-[3.5rem] inline-flex divide-x divide-white rounded-md shadow-sm">
                <Listbox.Button className="inline-flex items-center rounded-l-none rounded-r-md bg-white p-2 hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 focus:ring-offset-gray-50">
                  <span className="sr-only">Change published status</span>
                  <ChevronDownIcon
                    className="mr-[200px] h-5 w-5 text-white"
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
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="23"
                                height="23"
                                viewBox="0 0 23 23"
                                fill="none"
                              >
                                <circle
                                  cx="11.5"
                                  cy="11.5"
                                  r="10.75"
                                  stroke="#6B7280"
                                  stroke-width="1.5"
                                />
                                <path
                                  fill-rule="evenodd"
                                  clip-rule="evenodd"
                                  d="M15.5572 8.56597C15.6048 8.60206 15.6448 8.64717 15.6749 8.69872C15.705 8.75027 15.7247 8.80725 15.7327 8.86639C15.7408 8.92554 15.7371 8.98569 15.7218 9.0434C15.7066 9.10111 15.6801 9.15525 15.6438 9.20272L10.7954 15.5582C10.7561 15.6097 10.7062 15.6522 10.6491 15.6828C10.592 15.7134 10.5289 15.7315 10.4642 15.7358C10.3995 15.7401 10.3347 15.7305 10.274 15.7077C10.2133 15.6849 10.1582 15.6494 10.1124 15.6036L7.38518 12.8798C7.30489 12.7938 7.26118 12.6799 7.26325 12.5623C7.26533 12.4447 7.31304 12.3325 7.39631 12.2493C7.47959 12.1662 7.59195 12.1185 7.7097 12.1164C7.82746 12.1144 7.94143 12.158 8.02759 12.2382L10.3876 14.5946L14.9208 8.65252C14.9938 8.55686 15.1018 8.49401 15.2211 8.47779C15.3404 8.46156 15.4613 8.49327 15.5572 8.56597Z"
                                  fill="#6B7280"
                                  stroke="#6B7280"
                                />
                              </svg>
                            ) : index === 1 ? ( // Use CheckIcon for the second option
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="17"
                                height="18"
                                viewBox="0 0 17 18"
                                fill="none"
                              >
                                <rect
                                  x="0.75"
                                  y="0.959473"
                                  width="15.5"
                                  height="15.5"
                                  rx="3.25"
                                  stroke="#6B7280"
                                  stroke-width="1.5"
                                />
                                <path
                                  fill-rule="evenodd"
                                  clip-rule="evenodd"
                                  d="M11.8516 6.28575C11.8909 6.31556 11.9239 6.35283 11.9488 6.39541C11.9737 6.438 11.9899 6.48507 11.9966 6.53393C12.0032 6.58279 12.0002 6.63247 11.9876 6.68015C11.975 6.72782 11.9531 6.77255 11.9231 6.81176L7.91794 12.0619C7.88545 12.1045 7.84423 12.1396 7.79704 12.1649C7.74985 12.1902 7.69779 12.2051 7.64435 12.2086C7.59091 12.2122 7.53732 12.2043 7.48719 12.1855C7.43706 12.1666 7.39155 12.1373 7.35371 12.0994L5.10078 9.84936C5.03445 9.77827 4.99834 9.68425 5.00006 9.58709C5.00177 9.48994 5.04118 9.39724 5.10998 9.32853C5.17877 9.25983 5.27159 9.22047 5.36886 9.21875C5.46614 9.21704 5.56029 9.2531 5.63147 9.31935L7.581 11.2659L11.3259 6.35725C11.3861 6.27822 11.4753 6.22631 11.5739 6.2129C11.6725 6.1995 11.7723 6.2257 11.8516 6.28575Z"
                                  fill="#6B7280"
                                  stroke="#6B7280"
                                />
                              </svg>
                            ) : index === 2 ? ( // Use ChevronDownIcon for the third option
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="19"
                                height="16"
                                viewBox="0 0 19 16"
                                fill="none"
                              >
                                <path
                                  d="M2 1.4873H17M2 7.70953H17M2 13.9318H9.5"
                                  stroke="#6B7280"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                />
                              </svg>
                            ) : null}
                            <p
                              className={`text-center mx-auto ${
                                selected ? "font-semibold" : "font-normal"
                              }`}
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
    </div>
  );
}

export default Dropdown;
