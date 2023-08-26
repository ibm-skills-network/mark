"use client";

import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {}

function AuthorHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const assignmentID = pathname.split("/")[2]; // ex: /author/1234/introduction

  const steps = [
    {
      id: 1,
      name: "Set Up Intro",
      href: `/author/${assignmentID}`,
    },
    {
      id: 2,
      name: "Questions & Review",
      href: `/author/${assignmentID}/questions`,
    },
    {
      id: 3,
      name: "Preview",
      href: `/author/${assignmentID}/preview`,
    },
  ];

  function getCurrentId() {
    const currentStep = steps.find((step) => step.href === pathname);
    return currentStep?.id;
  }

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 bg-white justify-between gap-x-16 grid grid-cols-4">
      <div className="flex">
        <div className="flex flex-col justify-center pr-4">
          <SNIcon />
        </div>
        <div>
          <Title
            text="Auto-Graded Assignment Creator"
            className="text-lg font-semibold leading-6"
          />
          <div className="text-gray-500 font-medium text-sm leading-5">
            title of assignment
          </div>
        </div>
      </div>
      <nav aria-label="Progress" className="col-span-2 w-full">
        <ol role="list" className="space-y-4 sm:flex md:space-x-8 sm:space-y-0">
          {steps.map(({ name, href, id }) => (
            <li key={name} className="sm:flex-1 w-full">
              {id < getCurrentId() ? (
                // completed
                <Link
                  href={href}
                  className="group w-full flex flex-col border-l-4 border-indigo-600 py-2 pl-4 hover:border-indigo-800 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                >
                  <span className="text-sm font-medium text-indigo-600 group-hover:text-indigo-800">
                    Step {id}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </Link>
              ) : pathname === href ? (
                // current
                <Link
                  href={href}
                  className="flex w-full flex-col border-l-4 border-indigo-600 py-2 pl-4 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                  aria-current="step"
                >
                  <span className="text-sm font-medium text-indigo-600">
                    Step {id}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </Link>
              ) : (
                // incomplete
                <button className="group w-full flex flex-col border-l-4 border-gray-200 py-2 pl-4 hover:border-gray-300 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4">
                  <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700">
                    Step {id}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="text-end">buttons and settings</div>
    </header>
  );
}

export default AuthorHeader;
