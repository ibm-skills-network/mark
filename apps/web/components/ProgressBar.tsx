import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useState } from "react";

export type JobStatus = "In Progress" | "Completed" | "Failed";

interface ProgressBarProps {
  progress: number;
  currentMessage: string;
  status: JobStatus;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  currentMessage,
  status,
}) => {
  // Maintain a list of messages.
  const [messages, setMessages] = useState<string[]>([]);

  // Add a new message only if it's different from the last.
  useEffect(() => {
    if (
      currentMessage &&
      (messages.length === 0 ||
        messages[messages.length - 1] !== currentMessage)
    ) {
      setMessages((prev) => [...prev, currentMessage]);
    }
  }, [currentMessage, messages]);

  // Only display the latest message.
  const latestMessage = messages[messages.length - 1];

  // Determine bar colors based on status.
  const getBarColor = () => {
    if (status === "Completed")
      return "bg-gradient-to-r from-green-400 to-green-600";
    if (status === "Failed") return "bg-gradient-to-r from-red-400 to-red-600";
    return "bg-gradient-to-r from-violet-400 to-violet-600";
  };

  // Return appropriate icon based on status.
  const getStatusIcon = () => {
    if (status === "Completed") {
      return <CheckCircleIcon className="w-4 h-4 text-green-600 ml-1" />;
    } else if (status === "Failed") {
      return <XCircleIcon className="w-4 h-4 text-red-600 ml-1" />;
    }
    return null;
  };

  // Variants for progress bar fill.
  const progressVariants = {
    hidden: { width: 0 },
    visible: { width: `${progress}%` },
  };

  return (
    <div className="w-full p-4 bg-white rounded-lg shadow-md">
      {/* Animated Progress Bar */}
      <div className="relative mb-4">
        <div className="h-3 rounded-full bg-gray-200 overflow-hidden">
          <motion.div
            className={`${getBarColor()} h-full rounded-full shadow-md`}
            initial="hidden"
            animate="visible"
            variants={progressVariants}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-white font-bold text-xs flex items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {Math.round(progress)}% {getStatusIcon()}
          </motion.span>
        </div>
      </div>

      {/* Message Container with Slide Effect for the Latest Message */}
      <div className="relative h-6 overflow-hidden">
        <AnimatePresence mode="wait">
          {latestMessage && (
            <motion.div
              key={latestMessage}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-x-0 bottom-0 text-center text-xs text-gray-800"
            >
              {latestMessage}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ProgressBar;
