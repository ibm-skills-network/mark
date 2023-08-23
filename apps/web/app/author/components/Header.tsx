"use client";

import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {}

function AuthorHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();

  function getCurrentId() {
    const currentStep = steps.find((step) => step.href === pathname);
    return currentStep?.id;
  }

  const steps = [
    {
      id: 1,
      name: "Set Up Intro",
      href: "/author/introduction",
    },
    {
      id: 2,
      name: "Questions & Review",
      href: "/author/questions",
    },
    {
      id: 3,
      name: "Preview",
      href: "/author/preview",
    },
  ];

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 bg-white flex justify-between gap-x-16">
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
      <nav aria-label="Progress" className="flex-1">
        <ol role="list" className="space-y-4 md:flex md:space-x-8 md:space-y-0">
          {steps.map(({ name, href, id }) => (
            <li key={name} className="md:flex-1">
              {id < getCurrentId() ? (
                // completed
                <Link
                  href={href}
                  className="group flex flex-col border-l-4 border-indigo-600 py-2 pl-4 hover:border-indigo-800 md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4"
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
                  className="flex flex-col border-l-4 border-indigo-600 py-2 pl-4 md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4"
                  aria-current="step"
                >
                  <span className="text-sm font-medium text-indigo-600">
                    Step {id}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </Link>
              ) : (
                // incomplete
                <Link
                  href={href}
                  className="group flex flex-col border-l-4 border-gray-200 py-2 pl-4 hover:border-gray-300 md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4"
                >
                  <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700">
                    Step {id}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div>buttons and settings</div>
    </header>
  );
}

export default AuthorHeader;
