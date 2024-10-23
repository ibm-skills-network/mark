import { useAuthorStore } from "@/stores/author";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, FC, useState } from "react";
import { motion } from "framer-motion";
import Tooltip from "@/components/Tooltip";
import {
  DocumentTextIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";
import {
  publishStepOneData,
  publishStepTwoData,
} from "@/lib/sendZustandDataToBackend";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import { ArrowRightIcon } from "@heroicons/react/24/solid";
import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";

interface Step {
  id: number;
  name: string;
  href: string;
  icon: React.ComponentType<React.ComponentProps<typeof DocumentTextIcon>>;
  tooltip: string;
}

interface NavProps {
  currentStepId: number;
  setCurrentStepId: (id: number) => void;
}

export const Nav: FC<NavProps> = ({ currentStepId, setCurrentStepId }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [questions] = useAuthorStore((state) => [state.questions]);
  const regex = /author\/(\d+)/;
  const numbers = pathname.match(regex);
  const activeAssignmentId = numbers[1]; // This will give you the second number (ind
  const questionsAreReadyToBePublished =
    useQuestionsAreReadyToBePublished(questions);

  useEffect(() => {
    setCurrentStepId(getCurrentId());
  }, [pathname]);

  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const validateAssignmentConfig = useAssignmentConfig(
    (state) => state.validate,
  );
  const validateAssignmentSetup = useAuthorStore((state) => state.validate);

  const steps: Step[] = [
    {
      id: 0,
      name: "1. Overview",
      href: `/author/${activeAssignmentId}`,
      icon: DocumentTextIcon,
      tooltip: "Set up your assignment details",
    },
    {
      id: 1,
      name: "2. Settings",
      href: `/author/${activeAssignmentId}/config`,
      icon: Cog6ToothIcon,
      tooltip: "Configure assignment settings",
    },
    {
      id: 2,
      name: "3. Questions",
      href: `/author/${activeAssignmentId}/questions`,
      icon: QuestionMarkCircleIcon,
      tooltip: "Add and edit questions",
    },
    {
      id: 3,
      name: "4. Review",
      href: `/author/${activeAssignmentId}/review`,
      icon: MagnifyingGlassIcon,
      tooltip: "Review and publish your assignment",
    },
  ];

  const handleDisabled = (id: number) => {
    if (id === 3) {
      const { isValid, message, invalidQuestionId } =
        questionsAreReadyToBePublished();
      tooltipMessage = (
        <>
          <span>{message}</span>
          {!isValid && (
            <button
              onClick={() => {
                setFocusedQuestionId(invalidQuestionId);
                handleJumpToQuestion(`indexQuestion-${invalidQuestionId}`);
              }}
              className="ml-2 text-blue-500 hover:underline"
            >
              Take me there
            </button>
          )}
        </>
      );
      return !isValid;
    }
    return false;
  };

  const goToQuestionSetup = async (id: number) => {
    if (isSubmitting) return; // Prevent multiple clicks
    setIsSubmitting(true);

    // Perform validation and wait for it to complete
    const isAssignmentConfigValid = validateAssignmentConfig();

    if (isAssignmentConfigValid) {
      await publishStepTwoData(); // Submit the data if validation passes
      router.push(steps[id].href);
    } else {
      handleScrollToFirstErrorField(); // Scroll to the first error field
    }
    setIsSubmitting(false); // Reset the submit state to allow retry
  };
  const goToAssignmentConfig = async (id: number) => {
    if (isSubmitting) return; // Prevent multiple clicks
    setIsSubmitting(true);

    // Perform validation and wait for it to complete
    const isAssignmentSetupValid = validateAssignmentSetup();

    if (isAssignmentSetupValid) {
      await publishStepOneData(); // Submit the data if validation passes
      router.push(steps[id].href);
    } else {
      handleScrollToFirstErrorField(); // Scroll to the first error field
    }
    setIsSubmitting(false); // Reset the submit state to allow retry
  };

  async function handleStepClick(id: number) {
    const stepActions: Record<number, () => Promise<void>> = {
      0: async () => {
        await goToAssignmentConfig(id);
      },
      1: async () => {
        await goToQuestionSetup(id);
      },
    };

    // Check if the action exists for the current step
    const action = stepActions[currentStepId];

    if (currentStepId < id && action) {
      await action();
    } else {
      router.push(steps[id].href);
    }
  }

  const getCurrentId = () => {
    const currentStep = steps.find((step) => {
      return step.href === pathname;
    });
    return currentStep?.id ?? 0;
  };

  let tooltipMessage: React.ReactNode = "";

  return (
    <nav aria-label="Progress" className="flex-1 mx-8">
      <ol className="flex items-center justify-center space-x-5">
        {steps.map((step, index) => {
          const isCompleted = index < currentStepId;
          const isActive = index === currentStepId;
          const Icon = step.icon;

          return (
            <li key={step.id} className="flex items-center">
              <Tooltip
                disabled={!handleDisabled(step.id)}
                content={tooltipMessage}
                distance={-2}
              >
                <button
                  onClick={() => handleStepClick(index)}
                  disabled={handleDisabled(step.id)}
                  className="relative flex text-center p-2 gap-x-2 focus:outline-none items-center text-nowrap"
                >
                  <motion.div
                    initial={{ scale: 1 }}
                    animate={{ scale: isActive ? 1.2 : 1 }}
                    transition={{ duration: 0.3 }}
                    className={`w-5 h-5 flex items-center justify-center rounded-full  transition-colors duration-500 ease-in-out text-violet-600`}
                  >
                    <Icon />
                  </motion.div>
                  <span
                    className={`text-sm font-medium ${isActive ? "text-violet-600 font-bold" : "text-gray-500"}`}
                  >
                    {step.name}
                  </span>
                </button>
              </Tooltip>

              {/* Render the connecting dash after the step unless it's the last one */}
              {index < steps.length - 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                  }}
                  transition={{ duration: 0.5 }}
                  className={`mx-2 ${index < currentStepId ? "text-violet-600" : "text-gray-300"}`}
                >
                  <ArrowRightIcon className="w-5 h-5" />
                </motion.div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
