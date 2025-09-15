"use client";

import React from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Clock } from "lucide-react";

interface VersionStatusProps {
  className?: string;
  compact?: boolean;
}

export function VersionStatus({
  className = "",
  compact = false,
}: VersionStatusProps) {
  const { currentVersion, hasUnsavedChanges, formatVersionAge } =
    useVersionControl();

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <GitBranch className="h-3 w-3 text-gray-400" />
        <span className="text-xs text-gray-600">
          v{currentVersion?.versionNumber || "1"}
        </span>
        {currentVersion?.isDraft && (
          <Badge variant="secondary" className="text-xs h-4 px-1">
            Draft
          </Badge>
        )}
        {hasUnsavedChanges && (
          <div className="h-1.5 w-1.5 bg-amber-500 rounded-full"></div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <GitBranch className="h-4 w-4 text-gray-500" />
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">
          Version {currentVersion?.versionNumber || "1"}
        </span>

        <div className="flex items-center gap-1">
          {currentVersion?.isActive && (
            <Badge
              variant="default"
              className="text-xs bg-green-100 text-green-800"
            >
              Active
            </Badge>
          )}
          {currentVersion?.isDraft && (
            <Badge
              variant="secondary"
              className="text-xs bg-yellow-100 text-yellow-800"
            >
              Draft
            </Badge>
          )}
          {hasUnsavedChanges && (
            <Badge
              variant="outline"
              className="text-xs text-amber-700 border-amber-300"
            >
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 bg-amber-500 rounded-full"></div>
                Unsaved
              </div>
            </Badge>
          )}
        </div>
      </div>

      {currentVersion?.createdAt && (
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Clock className="h-3 w-3" />
          <span>{formatVersionAge(currentVersion.createdAt)}</span>
        </div>
      )}
    </div>
  );
}
