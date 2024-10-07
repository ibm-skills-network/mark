import { useAuthorStore } from "@/stores/author";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, FC, useState } from "react";
import { motion } from "framer-motion";
import Tooltip from "@/components/Tooltip";
import {
  IconClipboardList,
  IconSettings,
  IconQuestionMark,
  IconEyeCheck,
} from "@tabler/icons-react";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";
import {
  publishStepOneData,
  publishStepTwoData,
} from "@/lib/sendZustandDataToBackend";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";

interface Step {
  id: number;
  name: string;
  href: string;
  icon: React.ComponentType<React.ComponentProps<typeof IconClipboardList>>;
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
      name: "Assignment Setup",
      href: `/author/${activeAssignmentId}`,
      icon: IconClipboardList,
      tooltip: "Set up your assignment details",
    },
    {
      id: 1,
      name: "Assignment Config",
      href: `/author/${activeAssignmentId}/config`,
      icon: IconSettings,
      tooltip: "Configure assignment settings",
    },
    {
      id: 2,
      name: "Question Setup",
      href: `/author/${activeAssignmentId}/questions`,
      icon: IconQuestionMark,
      tooltip: "Add and edit questions",
    },
    {
      id: 3,
      name: "Review",
      href: `/author/${activeAssignmentId}/review`,
      icon: IconEyeCheck,
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
      <ol className="flex items-center justify-center space-x-4">
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
                  className="relative flex flex-col items-center text-center focus:outline-none"
                >
                  <motion.div
                    initial={{ scale: 1 }}
                    animate={{ scale: isActive ? 1.2 : 1 }}
                    transition={{ duration: 0.3 }}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors duration-500 ease-in-out ${
                      isCompleted
                        ? "bg-violet-600 text-white"
                        : isActive
                          ? "bg-white border-2 border-violet-600 text-violet-600"
                          : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    <Icon size={28} stroke={1.5} />
                  </motion.div>
                  <span
                    className={`mt-2 text-sm font-medium ${
                      isCompleted || isActive
                        ? "text-violet-600"
                        : "text-gray-500"
                    }`}
                  >
                    {step.name}
                  </span>
                </button>
              </Tooltip>

              {/* Render the connecting dash after the step unless it's the last one */}
              {index < steps.length - 1 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{
                    width: index < currentStepId ? "100%" : "0%",
                  }}
                  transition={{ duration: 0.5 }}
                  className="h-1 bg-violet-600 mx-2"
                ></motion.div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
