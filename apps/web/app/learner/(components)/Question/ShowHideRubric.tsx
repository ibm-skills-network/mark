import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import LearnerRubricTable from "./LearnerRubricTable";

interface SingleRubric {
  rubricQuestion: string;
  criteria: {
    description: string;
    points: number;
  }[];
}

interface ShowHideRubricProps {
  rubrics: SingleRubric[];
  className?: string;
  showRubrics: boolean;
  showPoints: boolean;
}

function ShowHideRubric({
  rubrics,
  className,
  showRubrics,
  showPoints,
}: ShowHideRubricProps) {
  const [showRubric, setShowRubric] = useState(false);

  const toggleRubric = () => {
    setShowRubric((prev) => !prev);
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        onClick={toggleRubric}
        className="inline-flex items-center gap-x-1 
                     px-3 py-2 text-sm font-medium 
                     typography-text rounded-md 
                     transition"
      >
        <span>{showRubric ? "Hide Rubric" : "Show Rubric"}</span>
        {showRubric ? (
          <ChevronUpIcon className="w-4 h-4" />
        ) : (
          <ChevronDownIcon className="w-4 h-4" />
        )}
      </button>

      <AnimatePresence>
        {showRubric && (
          <motion.div
            key="rubric"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <LearnerRubricTable
              rubrics={rubrics}
              showRubrics={showRubrics}
              showPoints={showPoints}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export default ShowHideRubric;
