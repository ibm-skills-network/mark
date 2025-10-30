import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import { handleJumpToQuestionTitle } from "@/app/Helpers/handleJumpToQuestion";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import {
  ArrowRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { FC, useEffect, useState } from "react";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";

interface Step {
  id: number;
  name: string;
  href: string;
  icon: React.ComponentType<React.ComponentProps<typeof DocumentTextIcon>>;
  tooltip: string;
}

interface WhatsNewFeature {
  stepId: number;
  expiresAt: string;
  title: string;
  items: string[];
}

interface NavProps {
  currentStepId: number;
  setCurrentStepId: (id: number) => void;
}

const NewBadge: FC<{ feature: WhatsNewFeature }> = ({ feature }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="relative">
      <motion.div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="absolute -bottom-6 left-1/2 transform -translate-x-1/2"
        initial={{ scale: 0, y: -10 }}
        animate={{ scale: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 15,
          delay: 0.2,
        }}
      >
        <motion.span
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-full cursor-pointer shadow-lg"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <motion.div
            animate={{
              rotate: [0, 15, -15, 0],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatType: "reverse",
            }}
          >
            <SparklesIcon className="w-3.5 h-3.5" />
          </motion.div>
          NEW
        </motion.span>

        <motion.div
          className="absolute inset-0 rounded-full bg-purple-400 opacity-75 blur-xl"
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 0.2, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatType: "reverse",
          }}
        />
      </motion.div>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 translate-y-full z-50"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mt-3 w-72 p-4 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white rounded-xl shadow-2xl backdrop-blur-sm border border-purple-500/20">
              <div className="relative">
                <motion.div
                  className="absolute -top-6 left-1/2 transform -translate-x-1/2"
                  initial={{ y: 5 }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-purple-900"></div>
                </motion.div>

                <div className="absolute -top-2 -right-2">
                  <motion.div
                    animate={{
                      rotate: 15,
                      scale: [0.8, 1.2, 0.8],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  >
                    <SparklesIcon className="w-4 h-4 text-yellow-400" />
                  </motion.div>
                </div>

                <h4 className="font-bold text-base mb-3 text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-pink-200">
                  ✨ {feature.title}
                </h4>

                <ul className="space-y-2">
                  {feature.items.map((item, idx) => (
                    <motion.li
                      key={idx}
                      className="text-sm flex items-start gap-2"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <span className="text-purple-300 mt-0.5 flex-shrink-0">
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.1 + idx * 0.05 }}
                        >
                          ✦
                        </motion.span>
                      </span>
                      <span className="text-gray-100">{item}</span>
                    </motion.li>
                  ))}
                </ul>

                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-purple-900/50 to-transparent pointer-events-none rounded-b-xl" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const Nav: FC<NavProps> = ({ currentStepId, setCurrentStepId }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [questions] = useAuthorStore((state) => [state.questions]);
  const regex = /author\/(\d+)/;
  const numbers = pathname.match(regex);
  const activeAssignmentId = numbers[1];
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

  const handleDisabled = (id: number) => {
    if (id === 3) {
      const { isValid, message, step, invalidQuestionId } =
        questionsAreReadyToBePublished();
      const handleNavigate = () => {
        if (invalidQuestionId) {
          setFocusedQuestionId(invalidQuestionId);
          setTimeout(() => {
            handleJumpToQuestionTitle(invalidQuestionId.toString());
          }, 0);
        }
        if (step) {
          if (step === 1) router.push(`/author/${activeAssignmentId}`);
          if (step === 2) router.push(`/author/${activeAssignmentId}/config`);
          if (step === 3)
            router.push(`/author/${activeAssignmentId}/questions`);
        }
      };
      tooltipMessage = (
        <>
          <span>{message}</span>
          {!isValid && invalidQuestionId && (
            <button
              onClick={handleNavigate}
              className="ml-2 text-purple-500 hover:underline"
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

  let tooltipMessage: React.ReactNode = "";

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
