import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface GradingProgressModalProps {
  isOpen: boolean;
  progress: number;
  message: string;
  status: "idle" | "processing" | "completed" | "failed";
}

export default function GradingProgressModal({
  isOpen,
  progress,
  message,
  status,
}: GradingProgressModalProps) {
  const getStatusColor = () => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "processing":
        return "bg-purple-500";
      default:
        return "bg-gray-400";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "completed":
        return (
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );

      case "failed":
        return (
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4"
          >
            <div className="text-center">
              <div className="mb-6 relative">
                {status === "processing" ? (
                  <div className="relative w-24 h-24 mx-auto">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                      className="absolute inset-0"
                    >
                      <svg className="w-full h-full" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="#e5e7eb"
                          strokeWidth="8"
                        />

                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="#8b5cf6"
                          strokeWidth="8"
                          strokeDasharray={`${progress * 2.83} 283`}
                          strokeLinecap="round"
                          transform="rotate(-90 50 50)"
                        />
                      </svg>
                    </motion.div>

                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.span
                        key={progress}
                        initial={{ scale: 1.2 }}
                        animate={{ scale: 1 }}
                        className="text-2xl font-bold text-purple-600"
                      >
                        {progress}%
                      </motion.span>
                    </div>
                  </div>
                ) : (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 15, stiffness: 200 }}
                    className={`w-24 h-24 mx-auto rounded-full ${getStatusColor()} flex items-center justify-center`}
                  >
                    {getStatusIcon()}
                  </motion.div>
                )}
              </div>

              <h3 className="text-xl font-semibold mb-2">
                {status === "processing" && "Grading Your Assignment"}
                {status === "completed" && "Grading Complete!"}
                {status === "failed" && "Grading Failed"}
              </h3>

              <h3 className="text-gray-500 text-md mb-4">
                Please don't close this tab. Your assignment is being marked.
              </h3>

              <motion.p
                key={message}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-gray-600 mb-6 min-h-[48px] flex items-center justify-center"
              >
                {message}
              </motion.p>

              {status === "processing" && (
                <div className="mb-6">
                  <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className="bg-purple-500 h-full rounded-full relative"
                    >
                      <motion.div
                        animate={{ x: ["0%", "200%"] }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      />
                    </motion.div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
