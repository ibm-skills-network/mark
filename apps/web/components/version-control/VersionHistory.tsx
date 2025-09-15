"use client";

import React, { useState, useEffect } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Modal from "@/components/Modal";
import {
  History,
  GitBranch,
  Clock,
  User,
  Eye,
  RotateCcw,
  GitCompare,
} from "lucide-react";

interface VersionHistoryProps {
  className?: string;
}

export function VersionHistory({ className = "" }: VersionHistoryProps) {
  const {
    versions,
    currentVersion,
    getVersionHistory,
    restoreVersion,
    compareVersions,
    formatVersionAge,
  } = useVersionControl();

  const [isOpen, setIsOpen] = useState(false);
  const [versionHistory, setVersionHistory] = useState<any[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadVersionHistory();
    }
  }, [isOpen]);

  const loadVersionHistory = async () => {
    setIsLoading(true);
    try {
      const history = await getVersionHistory();
      setVersionHistory(history);
    } catch (error) {
      console.error("Failed to load version history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVersionSelect = (versionId: number) => {
    if (selectedVersions.includes(versionId)) {
      setSelectedVersions(selectedVersions.filter((id) => id !== versionId));
    } else if (selectedVersions.length < 2) {
      setSelectedVersions([...selectedVersions, versionId]);
    }
  };

  const handleRestoreVersion = async (versionId: number) => {
    await restoreVersion(versionId, true);
    setIsOpen(false);
  };

  const handleCompareVersions = async () => {
    if (selectedVersions.length === 2) {
      await compareVersions(selectedVersions[0], selectedVersions[1]);
      setSelectedVersions([]);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "created":
        return <GitBranch className="h-3 w-3" />;
      case "published":
        return <Eye className="h-3 w-3" />;
      case "restored":
        return <RotateCcw className="h-3 w-3" />;
      case "draft_saved":
        return <Clock className="h-3 w-3" />;
      default:
        return <GitBranch className="h-3 w-3" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "created":
        return "bg-green-100 text-green-700";
      case "published":
        return "bg-blue-100 text-blue-700";
      case "restored":
        return "bg-orange-100 text-orange-700";
      case "draft_saved":
        return "bg-gray-100 text-gray-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <>
      <button
        className={`text-sm text-gray-600 hover:text-violet-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors ${className}`}
        onClick={() => setIsOpen(true)}
      >
        <History className="h-4 w-4" />
        History
      </button>

      {isOpen && (
        <Modal onClose={() => setIsOpen(false)} Title="Version History">
          <div className="max-h-[60vh] overflow-hidden">
            <div className="flex gap-4 h-[60vh]">
              {/* Version List */}
              <div className="flex-1 border rounded-lg p-4 overflow-y-auto">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  All Versions ({versions.length})
                </h3>

                {selectedVersions.length === 2 && (
                  <div className="mb-4">
                    <Button
                      onClick={handleCompareVersions}
                      className="w-full flex items-center gap-2"
                    >
                      <GitCompare className="h-4 w-4" />
                      Compare Selected Versions
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedVersions.includes(version.id)
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      } ${
                        version.id === currentVersion?.id
                          ? "ring-2 ring-green-500 ring-opacity-50"
                          : ""
                      }`}
                      onClick={() => handleVersionSelect(version.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">
                              Version {version.versionNumber}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {version.isActive && (
                              <Badge variant="default" className="text-xs">
                                Current
                              </Badge>
                            )}
                            {version.isDraft && (
                              <Badge variant="secondary" className="text-xs">
                                Draft
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-gray-500">
                            {formatVersionAge(version.createdAt)}
                          </div>
                          <div className="text-xs text-gray-400 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {version.createdBy}
                          </div>
                        </div>
                      </div>

                      {version.versionDescription && (
                        <div className="mt-2 text-sm text-gray-600">
                          {version.versionDescription}
                        </div>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-gray-500">
                          {version.questionCount} question
                          {version.questionCount !== 1 ? "s" : ""}
                        </div>

                        {version.id !== currentVersion?.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestoreVersion(version.id);
                            }}
                            className="text-xs"
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Restore as New
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {versions.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No versions found</p>
                    <p className="text-sm">
                      Create your first version by publishing the assignment
                    </p>
                  </div>
                )}
              </div>

              {/* Activity Timeline */}
              <div className="flex-1 border rounded-lg p-4 overflow-y-auto">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Activity Timeline
                </h3>

                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                    <span className="ml-2 text-gray-500">
                      Loading history...
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {versionHistory.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-b-0"
                      >
                        <div
                          className={`p-1 rounded-full ${getActionColor(entry.action)}`}
                        >
                          {getActionIcon(entry.action)}
                        </div>

                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium capitalize">
                              {entry.action.replace("_", " ")}
                              {entry.toVersion && (
                                <span className="ml-1 text-gray-500">
                                  v{entry.toVersion.versionNumber}
                                </span>
                              )}
                            </p>
                            <span className="text-xs text-gray-400">
                              {formatVersionAge(entry.createdAt)}
                            </span>
                          </div>

                          {entry.description && (
                            <p className="text-xs text-gray-600 mt-1">
                              {entry.description}
                            </p>
                          )}

                          <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.userId}
                          </div>
                        </div>
                      </div>
                    ))}

                    {versionHistory.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No activity history</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-sm text-gray-500">
                {selectedVersions.length === 0 && "Select versions to compare"}
                {selectedVersions.length === 1 &&
                  "Select one more version to compare"}
                {selectedVersions.length === 2 &&
                  "Ready to compare selected versions"}
              </div>

              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
