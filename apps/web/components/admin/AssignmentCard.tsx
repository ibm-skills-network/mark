// components/admin/AssignmentCard.tsx
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarIcon,
  UsersIcon,
  ClockIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  ShareIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/outline";
import { Assignment } from "@/config/types";

interface AssignmentCardProps {
  assignment: Assignment;
  onShare: () => void;
  onDelete: () => void;
}

export default function AssignmentCard({
  assignment,
  onShare,
  onDelete,
}: AssignmentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const launchAs = (mode: "author" | "learner") => {
    window.open(`/${mode}/${assignment.id}`, "_blank");
  };

  return (
    <motion.div
      className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300"
      whileHover={{ y: -5 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
    >
      <div className="p-5">
        <div className="flex justify-between items-start">
          <h3
            className="text-lg font-semibold text-gray-900 truncate"
            title={assignment.name}
          >
            {assignment.name || "Untitled Assignment"}
          </h3>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              assignment.published
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {assignment.published ? "Published" : "Draft"}
          </span>
        </div>

        <p
          className="mt-2 text-sm text-gray-600 line-clamp-2"
          title={assignment.introduction || ""}
        >
          {assignment.introduction || "No description provided."}
        </p>

        <div className="mt-4 flex items-center text-xs text-gray-500 space-x-4">
          <div className="flex items-center">
            <CalendarIcon className="h-4 w-4 mr-1" />
            <span>{formatDate(String(assignment.updatedAt))}</span>
          </div>

          <div className="flex items-center">
            <UsersIcon className="h-4 w-4 mr-1" />
            <span>{Math.floor(Math.random() * 100)} learners</span>
          </div>

          {assignment.timeEstimateMinutes && (
            <div className="flex items-center">
              <ClockIcon className="h-4 w-4 mr-1" />
              <span>{assignment.timeEstimateMinutes} min</span>
            </div>
          )}

          <div className="flex items-center">
            {assignment.published ? (
              <LockOpenIcon className="h-4 w-4 mr-1" />
            ) : (
              <LockClosedIcon className="h-4 w-4 mr-1" />
            )}
          </div>
        </div>
      </div>

      <div className="bg-gray-50 p-3 border-t border-gray-100">
        <div className="flex justify-between">
          <div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => launchAs("author")}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
            >
              <PencilIcon className="h-3.5 w-3.5 mr-1" />
              Edit
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => launchAs("learner")}
              className="ml-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
            >
              <EyeIcon className="h-3.5 w-3.5 mr-1" />
              Preview
            </motion.button>
          </div>

          <div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onShare}
              className="inline-flex items-center p-1.5 text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
              title="Share assignment"
            >
              <ShareIcon className="h-3.5 w-3.5" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onDelete}
              className="ml-1 inline-flex items-center p-1.5 text-red-500 bg-white border border-gray-300 rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              title="Delete assignment"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* Hover animation for highlighting */}
      <motion.div
        className="absolute inset-0 rounded-lg border-2 border-violet-500 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      />
    </motion.div>
  );
}
