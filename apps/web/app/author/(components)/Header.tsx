"use client";

import { createQuestion, updateQuestion } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { EyeIcon } from "@heroicons/react/outline";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {}

function AuthorHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();
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

  function handlePublishButton() {
    const confirmPublish = confirm("Are you sure you want to publish?");
    if (confirmPublish) {
      questions.forEach(async (question) => {
        // remove values that are not needed in the backend
        const { alreadyInBackend, id, assignmentId, ...dataToSend } = question;
        console.log("alreadyInBackend", alreadyInBackend, "id", id);
        // conclude the total points of the question by taking the last element of the criteria array
        dataToSend.totalPoints =
          dataToSend.scoring?.criteria?.slice(-1)[0].points || 0;
        if (alreadyInBackend) {
          // update question if it's already in the backend
          // TODO: this can be optimized by only sending the data that has changed
          // and if nothing has changed, don't send anything to the backend
          // an idea for that is to have a "modified" flag in the question object
          // or store the original question object in a separate variable
          const questionId = await updateQuestion(assignmentId, id, dataToSend);
          console.log("updateQuestion", questionId);
        } else {
          // create question if it's not already in the backend
          console.log("dataToSend", dataToSend, "assignmentId", assignmentId);
          const questionId = await createQuestion(assignmentId, dataToSend);
          modifyQuestion(id, { alreadyInBackend: true }); // to handle the case where the user clicks on publish multiple times
          console.log("createQuestion", questionId);
        }
      });
    }
  }

  const steps = [
    {
      id: 1,
      name: "Set Up Intro",
      href: `/author/${activeAssignmentId}`,
    },
    {
      id: 2,
      name: "Questions & Review",
      href: `/author/${activeAssignmentId}/questions`,
    },
  ];

  function getCurrentId() {
    const currentStep = steps.find((step) => step.href === pathname);
    return currentStep?.id;
  }

  function handleIncompleteClick(id) {
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
            {assignmentTitle || "Untitled Assignment"}
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
        <button
          type="button"
          disabled={questions.length === 0}
          onClick={handlePublishButton}
          className="inline-flex leading-6 items-center px-4 py-2 border border-transparent font-medium rounded-md text-white bg-blue-700 hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Publish
        </button>

        <button
          onClick={() => alert("Coming soon!")}
          className="inline-flex items-center px-4 py-2 border border-transparent leading-6 font-medium rounded-md text-blue-700 hover:text-blue-500 bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <EyeIcon className="h-5 w-5 mr-2" aria-hidden="true" />
          Learner View
        </button>
      </div>
    </header>
  );
}

export default AuthorHeader;
