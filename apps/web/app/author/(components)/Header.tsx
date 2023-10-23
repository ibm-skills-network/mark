"use client";

import { createQuestion, updateQuestion } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { EyeIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface Props {}

function AuthorHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const router = useRouter();
  const activeAssignmentId = useAuthorStore(
    (state) => state.activeAssignmentId
  );
  const assignmentTitle = useAuthorStore((state) => state.assignmentTitle);
  const updateAssignmentButtonRef = useAuthorStore(
    (state) => state.updateAssignmentButtonRef
  );
  const [questions, modifyQuestion] = useAuthorStore((state) => [
    state.questions,
    state.modifyQuestion,
  ]);

  const [isOpen, setIsOpen] = useState(false);

  // check if all questions have been filled out
  const enablePublishButton = useMemo(() => {
    // TODO: show a custom error message for each case
    return questions.every((question) => {
      const { type, question: questionText, choices, scoring } = question;
      const questionTextFilledOut = questionText?.trim().length > 0;
      if (type === "URL" || type === "TEXT") {
        //criteria needs to be filled out
        const criteriaFilledOut =
          scoring?.criteria?.length > 0 &&
          scoring?.criteria?.every((criterion) => {
            return criterion.description?.trim().length > 0;
          });
        if (!criteriaFilledOut) {
          // disable publish button if criteria is not filled out
          return false;
        }
      }
      // if type is multiple correct, check if there are at least 2 choices
      if (type === "MULTIPLE_CORRECT") {
        if (!choices) {
          // disable publish button if choices is not filled out
          return false;
        }
        const keys = Object.keys(choices);
        const choicesFilledOut = keys.every((key) => {
          return key?.trim().length > 0;
        });
        const isTwoOrMoreChoices = keys.length >= 2;
        const isAtLeastOneCorrectChoice = keys.some((key) => {
          return choices[key];
        });
        if (
          !choicesFilledOut ||
          !isTwoOrMoreChoices ||
          !isAtLeastOneCorrectChoice
        ) {
          // disable publish button if choices requirements is not satisfied
          return false;
        }
      }
      return questionTextFilledOut;
    });
  }, [questions]);

  async function handlePublishButton() {
    const confirmPublish = confirm("Are you sure you want to publish?");
    if (!confirmPublish) {
      return;
    }
    const promises = questions.map(async (question, index) => {
      const questionNumber = index + 1;
      // remove values that are not needed in the backend
      const { alreadyInBackend, id, assignmentId, ...dataToSend } = question;
      dataToSend.number = questionNumber;
      console.log("alreadyInBackend", alreadyInBackend, "id", id);
      // conclude the total points of the question by taking the last element of the criteria array if question is TEXT or URL
      if (dataToSend.type === "TEXT" || dataToSend.type === "URL") {
        dataToSend.totalPoints =
          dataToSend.scoring?.criteria?.at(-1).points || 0;
        // remove id from criteria
        dataToSend.scoring?.criteria?.forEach((criteria) => {
          delete criteria.id;
        });
      } else if (dataToSend.type === "MULTIPLE_CORRECT") {
        console.log("dataToSend.choices", dataToSend.choices);
        dataToSend.scoring = null; // scoring is not needed for multiple correct
      }
      // if numRetries is -1 (unlimited), set it to null
      const unlimitedRetries = dataToSend.numRetries === -1;
      dataToSend.numRetries = unlimitedRetries ? null : dataToSend.numRetries;
      console.log("dataToSend", dataToSend.numRetries);
      let questionId: number; // reset questionId
      if (alreadyInBackend) {
        // update question if it's already in the backend
        // TODO: this can be optimized by only sending the data that has changed
        // and if nothing has changed, don't send anything to the backend
        // an idea for that is to have a "modified" flag in the question object
        // or store the original question object in a separate variable
        questionId = await updateQuestion(assignmentId, id, dataToSend);
      } else {
        // create question if it's not already in the backend
        questionId = await createQuestion(assignmentId, dataToSend);
        // to handle the case where the user clicks on publish multiple times (deprecated)
        // modifyQuestion(questionId, { alreadyInBackend: true });
      }
      return questionId;
    });
    const results = await Promise.allSettled(promises); // wait for all promises to resolve
    // only redirect if all promises are fulfilled and have a value(questionId from the backend)
    const allPromisesFulfilled = results.every(
      (result) => result.status === "fulfilled" && result.value
    );
    if (allPromisesFulfilled) {
      const currentTime = Date.now();
      console.log("currentTime", currentTime);
      router.push(
        `/author/${activeAssignmentId}?submissionTime=${currentTime}`
      ); // add the submissionTime query param to the url
    } else {
      toast.error(`Couldn't publish all questions. Please try again.`);
    }
  }

  const steps = [
    {
      id: 1,
      name: "Set up your assignment",
      href: `/author/${activeAssignmentId}`,
    },
    {
      id: 2,
      name: "Create questions",
      href: `/author/${activeAssignmentId}/questions`,
    },
  ];

  function getCurrentId() {
    const currentStep = steps.find((step) => step.href === pathname);
    return currentStep?.id;
  }

  function handleIncompleteClick(id: number) {
    // when clicking on step 2, it will click the update button located in the bottom of the page
    // if (id === 2) updateAssignmentButtonRef.current?.click();
    switch (id) {
      case 2:
        updateAssignmentButtonRef.current?.click();
        break;
      default:
        break;
    }
  }

  return (
    <div className="fixed w-full z-50">
      <header className="border-b border-gray-300 px-6 py-6 bg-white justify-between gap-x-16 grid grid-cols-4">
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
              {assignmentTitle || "Untitled Assignment"}
            </div>
          </div>
        </div>
        <nav aria-label="Progress" className="col-span-2 w-full">
          <ol
            role="navigation"
            className="space-y-4 sm:flex md:space-x-8 sm:space-y-0"
          >
            {steps.map(({ name, href, id }) => (
              <li key={name} className="sm:flex-1 w-full">
                {id < getCurrentId() ? (
                  // completed
                  <Link
                    href={href}
                    className="group transition w-full flex flex-col border-l-4 border-blue-700 py-2 pl-4 hover:border-blue-500 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                  >
                    <span className="text-sm font-medium text-blue-700 group-hover:text-blue-500">
                      Step {id}
                    </span>
                    <span className="text-sm font-medium">{name}</span>
                  </Link>
                ) : pathname === href ? (
                  // current
                  <Link
                    href={href}
                    className="group flex w-full flex-col border-l-4 border-blue-700 hover:border-blue-500 py-2 pl-4 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                    aria-current="step"
                  >
                    <span className="text-sm font-medium text-blue-700 group-hover:text-blue-500">
                      Step {id}
                    </span>
                    <span className="text-sm font-medium">{name}</span>
                  </Link>
                ) : (
                  // incomplete
                  <button
                    className="group w-full flex flex-col border-l-4 border-gray-200 py-2 pl-4 hover:border-gray-300 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                    onClick={() => handleIncompleteClick(id)}
                  >
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
        <div className="items-center flex justify-end gap-x-2.5">
          {getCurrentId() === 2 && (
            <button
              type="button"
              disabled={!enablePublishButton}
              onClick={handlePublishButton}
              className="inline-flex leading-6 items-center px-4 py-2 border border-transparent font-medium rounded-md text-white bg-blue-700 enabled:hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
            >
              Save & Publish
            </button>
          )}

          <button
            onClick={() => alert("Coming soon!")}
            className="inline-flex items-center px-4 py-2 border border-transparent leading-6 font-medium rounded-md text-blue-700 hover:text-blue-500 bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <EyeIcon className="h-5 w-5 mr-2" aria-hidden="true" />
            Learner View
          </button>
        </div>
      </header>
      {/* table of contents */}
      <div className="w-full">
        <div className="flex gap-4 my-0 justify-end bg-white border-b border-gray-300">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex group justify-center gap-x-1.5 px-3 py-2 text-sm font-semibold"
            id="menu-button"
            aria-expanded={isOpen} // Set aria-expanded to the value of isOpen
            aria-haspopup="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M5.99999 4.75C5.99999 4.55109 6.07901 4.36032 6.21966 4.21967C6.36031 4.07902 6.55108 4 6.74999 4H17.25C17.4489 4 17.6397 4.07902 17.7803 4.21967C17.921 4.36032 18 4.55109 18 4.75C18 4.94891 17.921 5.13968 17.7803 5.28033C17.6397 5.42098 17.4489 5.5 17.25 5.5H6.74999C6.55108 5.5 6.36031 5.42098 6.21966 5.28033C6.07901 5.13968 5.99999 4.94891 5.99999 4.75ZM5.99999 10C5.99999 9.80109 6.07901 9.61032 6.21966 9.46967C6.36031 9.32902 6.55108 9.25 6.74999 9.25H17.25C17.4489 9.25 17.6397 9.32902 17.7803 9.46967C17.921 9.61032 18 9.80109 18 10C18 10.1989 17.921 10.3897 17.7803 10.5303C17.6397 10.671 17.4489 10.75 17.25 10.75H6.74999C6.55108 10.75 6.36031 10.671 6.21966 10.5303C6.07901 10.3897 5.99999 10.1989 5.99999 10ZM5.99999 15.25C5.99999 15.0511 6.07901 14.8603 6.21966 14.7197C6.36031 14.579 6.55108 14.5 6.74999 14.5H17.25C17.4489 14.5 17.6397 14.579 17.7803 14.7197C17.921 14.8603 18 15.0511 18 15.25C18 15.4489 17.921 15.6397 17.7803 15.7803C17.6397 15.921 17.4489 16 17.25 16H6.74999C6.55108 16 6.36031 15.921 6.21966 15.7803C6.07901 15.6397 5.99999 15.4489 5.99999 15.25ZM1.98999 4.75C1.98999 4.48478 2.09535 4.23043 2.28288 4.04289C2.47042 3.85536 2.72477 3.75 2.98999 3.75H2.99999C3.26521 3.75 3.51956 3.85536 3.7071 4.04289C3.89463 4.23043 3.99999 4.48478 3.99999 4.75V4.76C3.99999 5.02522 3.89463 5.27957 3.7071 5.46711C3.51956 5.65464 3.26521 5.76 2.99999 5.76H2.98999C2.72477 5.76 2.47042 5.65464 2.28288 5.46711C2.09535 5.27957 1.98999 5.02522 1.98999 4.76V4.75ZM1.98999 15.25C1.98999 14.9848 2.09535 14.7304 2.28288 14.5429C2.47042 14.3554 2.72477 14.25 2.98999 14.25H2.99999C3.26521 14.25 3.51956 14.3554 3.7071 14.5429C3.89463 14.7304 3.99999 14.9848 3.99999 15.25V15.26C3.99999 15.5252 3.89463 15.7796 3.7071 15.9671C3.51956 16.1546 3.26521 16.26 2.99999 16.26H2.98999C2.72477 16.26 2.47042 16.1546 2.28288 15.9671C2.09535 15.7796 1.98999 15.5252 1.98999 15.26V15.25ZM1.98999 10C1.98999 9.73478 2.09535 9.48043 2.28288 9.29289C2.47042 9.10536 2.72477 9 2.98999 9H2.99999C3.26521 9 3.51956 9.10536 3.7071 9.29289C3.89463 9.48043 3.99999 9.73478 3.99999 10V10.01C3.99999 10.2752 3.89463 10.5296 3.7071 10.7171C3.51956 10.9046 3.26521 11.01 2.99999 11.01H2.98999C2.72477 11.01 2.47042 10.9046 2.28288 10.7171C2.09535 10.5296 1.98999 10.2752 1.98999 10.01V10Z"
                fill="black"
              />
            </svg>
            Questions
            <svg
              className="-mr-1 h-5 w-5 text-blue-700 group-hover:translate-y-0.5 transition-transform ease-in-out"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        {isOpen && ( // Render the second div only when isOpen is true
          <div className="max-h-52 overflow-auto">
            {questions.map((question, index) => (
              <div key={index} className="flex gap-4 my-0 justify-end">
                <button
                  key={index}
                  type="button"
                  // onClick={() => handleScrollToTarget(question.id)}
                  className="inline-flex justify-center gap-x-1.5 w-[9.375rem] bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  Question {index + 1}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthorHeader;
