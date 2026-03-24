import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import {
  ArrowRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/solid";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { FC, useEffect, useState } from "react";

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
  const regex = /author\/(\d+)/;
  const numbers = pathname.match(regex);
  const activeAssignmentId = numbers[1];

  useEffect(() => {
    setCurrentStepId(getCurrentId());
  }, [pathname]);

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
      name: "2. Questions",
      href: `/author/${activeAssignmentId}/questions`,
      icon: QuestionMarkCircleIcon,
      tooltip: "Add and edit questions",
    },
    {
      id: 2,
      name: "3. Settings",
      href: `/author/${activeAssignmentId}/config`,
      icon: Cog6ToothIcon,
      tooltip: "Configure assignment settings",
    },
    {
      id: 3,
      name: "4. Review",
      href: `/author/${activeAssignmentId}/review`,
      icon: MagnifyingGlassIcon,
      tooltip: "Review and publish your assignment",
    },
  ];

  const goToQuestionSetup = (id: number) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const isAssignmentConfigValid = validateAssignmentConfig();

    if (isAssignmentConfigValid) {
      router.push(steps[id].href);
    } else {
      handleScrollToFirstErrorField();
    }
    setIsSubmitting(false);
  };
  const goToAssignmentConfig = (id: number) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const isAssignmentSetupValid = validateAssignmentSetup();

    if (isAssignmentSetupValid) {
      router.push(steps[id].href);
    } else {
      handleScrollToFirstErrorField();
    }
    setIsSubmitting(false);
  };

  async function handleStepClick(id: number) {
    const stepActions: Record<number, () => Promise<void>> = {
      0: void goToAssignmentConfig(id),
      1: void goToQuestionSetup(id),
    };

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

  return (
    <nav aria-label="Progress" className="flex-1">
      <ol className="flex items-center justify-center">
        {steps.map((step, index) => {
          const isActive = index === currentStepId;
          const isCompleted = index < currentStepId;
          const Icon = step.icon;

          return (
            <motion.li
              key={step.id}
              className="flex items-center"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="relative group">
                <motion.button
                  onClick={() => handleStepClick(index)}
                  className="relative flex text-center p-3 gap-x-2.5 focus:outline-none items-center text-nowrap rounded-lg transition-all duration-200"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {isActive && (
                    <motion.div
                      className="absolute inset-0 rounded-lg bg-violet-100"
                      layoutId="activeBackground"
                      transition={{
                        type: "spring",
                        stiffness: 350,
                        damping: 30,
                      }}
                    />
                  )}

                  <motion.div
                    initial={{ scale: 1 }}
                    animate={{
                      scale: isActive ? 1.3 : 1,
                    }}
                    transition={{
                      duration: 0.4,
                      type: "spring",
                      stiffness: 300,
                    }}
                    className={`w-6 h-6 flex items-center justify-center rounded-full relative z-10 ${
                      isActive
                        ? "text-violet-600 drop-shadow-lg"
                        : isCompleted
                          ? "text-violet-500"
                          : "text-gray-400"
                    }`}
                  >
                    <Icon className={isActive ? "drop-shadow-sm" : ""} />

                    {isCompleted && !isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center"
                      >
                        <span className="text-white text-[8px] font-bold">
                          ✓
                        </span>
                      </motion.div>
                    )}
                  </motion.div>

                  <span
                    className={`text-sm font-medium relative z-10 transition-all duration-200 ${
                      isActive
                        ? "text-violet-700 font-bold drop-shadow-sm"
                        : isCompleted
                          ? "text-violet-600 font-semibold"
                          : "text-gray-500 group-hover:text-gray-700"
                    }`}
                  >
                    {step.name}
                  </span>
                </motion.button>
              </div>

              {index < steps.length - 1 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  transition={{ duration: 0.3, delay: index * 0.1 + 0.1 }}
                  className={`mx-3 transition-colors duration-300 ${
                    index < currentStepId ? "text-violet-400" : "text-gray-300"
                  }`}
                >
                  <ArrowRightIcon className="w-5 h-5" />
                </motion.div>
              )}
            </motion.li>
          );
        })}
      </ol>
    </nav>
  );
};
