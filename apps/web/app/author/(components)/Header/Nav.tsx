import {
  publishStepOneData,
  publishStepTwoData,
} from "@/lib/sendZustandDataToBackend";
import { extractAssignmentId } from "@/lib/strings";
import { usePathname, useRouter } from "next/navigation";
import {
  Dispatch,
  SetStateAction,
  useEffect,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

interface Props extends ComponentPropsWithoutRef<"nav"> {
  currentStepId: number;
  setCurrentStepId: Dispatch<SetStateAction<number>>;
}

export const Nav: FC<Props> = ({ currentStepId, setCurrentStepId }) => {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setCurrentStepId(getCurrentId());
  }, [pathname]);
  if (!pathname) {
    return null;
  }
  const activeAssignmentId = extractAssignmentId(pathname);

  const steps = [
    {
      id: 0,
      name: "Assignment Set up",
      href: `/author/${activeAssignmentId}`,
    },
    {
      id: 1,
      name: "Assignment Config",
      href: `/author/${activeAssignmentId}/config`,
    },
    {
      id: 2,
      name: "Question Setup",
      href: `/author/${activeAssignmentId}/questions`,
    },
  ];

  function getCurrentId() {
    const currentStep = steps.find((step) => step.href === pathname);
    return currentStep?.id;
  }

  async function handleStepClick(id: number) {
    const stepOneToTwo = currentStepId === 0 && id === 1;
    const stepOneToThree = currentStepId === 0 && id === 2;
    const stepTwoToOne = currentStepId === 1 && id === 0;
    const stepTwoToThree = currentStepId === 1 && id === 2;
    const stepThreeToOne = currentStepId === 2 && id === 0;
    const stepThreeToTwo = currentStepId === 2 && id === 1;
    switch (true) {
      case stepOneToTwo:
        router.push(`/author/${activeAssignmentId}/config`);
        await publishStepOneData();
        break;
      case stepOneToThree:
        router.push(`/author/${activeAssignmentId}/questions`);
        await publishStepOneData();
        break;
      case stepTwoToOne:
        router.push(`/author/${activeAssignmentId}`);
        await publishStepTwoData();
        break;
      case stepTwoToThree:
        router.push(`/author/${activeAssignmentId}/questions`);
        await publishStepTwoData();
        break;
      case stepThreeToOne:
        router.push(`/author/${activeAssignmentId}`);
        break;
      case stepThreeToTwo:
        router.push(`/author/${activeAssignmentId}/config`);
        break;
    }
  }

  return (
    <nav aria-label="Progress" className="col-span-2 w-full">
      <ol
        role="navigation"
        className="space-y-4 sm:flex md:space-x-8 sm:space-y-0"
      >
        {steps.map(({ name, href, id }) => {
          const stepNumber = id + 1;
          return (
            <li key={name} className="sm:flex-1 w-full">
              {id < currentStepId ? (
                // completed
                <button
                  onClick={() => handleStepClick(id)}
                  type="button"
                  className="group transition w-full flex flex-col border-l-4 border-blue-700 py-2 pl-4 hover:border-blue-500 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                >
                  <span className="text-sm font-medium text-blue-700 group-hover:text-blue-500">
                    Step {stepNumber}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </button>
              ) : pathname === href ? (
                // current
                <button
                  onClick={() => handleStepClick(id)}
                  type="button"
                  className="group flex w-full flex-col border-l-4 border-blue-700 hover:border-blue-500 py-2 pl-4 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                  aria-current="step"
                >
                  <span className="text-sm font-medium text-blue-700 group-hover:text-blue-500">
                    Step {stepNumber}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </button>
              ) : (
                //
                <button
                  type="button"
                  className="group w-full flex flex-col border-l-4 border-gray-200 py-2 pl-4 hover:border-gray-300 sm:border-l-0 sm:border-t-4 sm:pb-0 sm:pl-0 sm:pt-4"
                  onClick={() => handleStepClick(id)}
                >
                  <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700">
                    Step {stepNumber}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
