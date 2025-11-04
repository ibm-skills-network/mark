"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import {
  Save,
  History,
  ChevronDown,
  RotateCcw,
  GitBranch,
  Zap,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface QuickVersionActionsProps {
  onSave: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  className?: string;
}

export function QuickVersionActions({
  onSave,
  hasUnsavedChanges,
  className = "",
}: QuickVersionActionsProps) {
  const {
    versions,
    currentVersion,
    restoreVersion,
    formatVersionAge,
    getPublishedVersions,
  } = useVersionControl();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const publishedVersions = getPublishedVersions().slice(0, 5);
  const hasOtherVersions =
    publishedVersions.filter((v) => !v.isActive).length > 0;

  const handleQuickRestore = async (
    versionId: number,
    versionNumber: string,
  ) => {
    await restoreVersion(versionId, true);
    setIsDropdownOpen(false);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Button
        onClick={onSave}
        disabled={!hasUnsavedChanges}
        variant={hasUnsavedChanges ? "default" : "ghost"}
        size="sm"
        className="flex items-center gap-2"
      >
        <Save className="h-4 w-4" />
        Save
      </Button>

      {hasOtherVersions && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Quick Restore
            <ChevronDown className="h-3 w-3" />
          </Button>

          {isDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsDropdownOpen(false)}
              />

              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[280px]">
                <div className="p-3">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Quick Restore
                  </h4>
                  <div className="space-y-2">
                    {publishedVersions
                      .filter((version) => !version.isActive)
                      .map((version) => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between p-2 hover:bg-gray-50 rounded"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <GitBranch className="h-3 w-3 text-gray-400" />
                              <span className="text-sm font-medium">
                                Version {version.versionNumber}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatVersionAge(version.createdAt)}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleQuickRestore(
                                version.id,
                                version.versionNumber,
                              )
                            }
                            className="text-xs"
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                  </div>

                  <div className="border-t pt-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsDropdownOpen(false)}
                      className="w-full text-xs"
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      View All Versions
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
