"use client";

import { cn } from "@/lib/strings";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import AssignmentCompletion from "./AssignmentCompletion";
import AssignmentFeedback from "./AssignmentFeedback";
import AssignmentQuestionControls from "./AssignmentQuestionControls";
import AssignmentQuestionDisplay from "./AssignmentQuestionDisplay";
import AssignmentQuestionOrder from "./AssignmentQuestionOrder";
import AssignmentRetakeAttempts from "./AssignmentRetakeAttempts";
import AssignmentTime from "./AssignmentTime";
import AssignmentType from "./AssignmentType";

function ConfigGroup({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 rounded group"
      >
        <span className="text-sm font-semibold tracking-widest uppercase text-gray-500 group-hover:text-gray-700 transition-colors">
          {title}
        </span>
        <ChevronDownIcon
          className={cn(
            "w-4 h-4 text-gray-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-y-4 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function ConfigGroups() {
  const [coreOpen, setCoreOpen] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(true);

  return (
    <div className="flex flex-col">
      <ConfigGroup
        title="Core"
        open={coreOpen}
        onToggle={() => setCoreOpen((v) => !v)}
      >
        <AssignmentType compact />
        <AssignmentTime compact />
        <AssignmentCompletion compact />
      </ConfigGroup>

      <hr className="border-gray-200" />

      <ConfigGroup
        title="Feedback"
        open={feedbackOpen}
        onToggle={() => setFeedbackOpen((v) => !v)}
      >
        <AssignmentFeedback compact />
      </ConfigGroup>

      <hr className="border-gray-200" />

      <ConfigGroup
        title="Advanced"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
      >
        <AssignmentRetakeAttempts compact />
        <AssignmentQuestionDisplay compact />
        <AssignmentQuestionOrder compact />
        <AssignmentQuestionControls compact />
      </ConfigGroup>
    </div>
  );
}
