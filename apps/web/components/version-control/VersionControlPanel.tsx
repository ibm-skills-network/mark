"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Modal from "@/components/Modal";
import { GitBranch, Eye, ChevronDown, History } from "lucide-react";
import { toast } from "sonner";

interface VersionControlPanelProps {
  onSave: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  className?: string;
}

export function VersionControlPanel({
  hasUnsavedChanges,
  className = "",
}: VersionControlPanelProps) {
  const {
    versions,
    currentVersion,
    checkedOutVersion,
    isLoadingVersions,
    versionsLoadFailed,
    loadVersions,
    restoreVersion,
    checkoutVersion,
    formatVersionAge,
    getDraftVersions,
    getPublishedVersions,

    drafts,
    isLoadingDrafts,
    draftsLoadFailed,
    loadDraft,
    deleteDraft,
  } = useVersionControl();

  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const handleRestoreVersion = async (
    versionId: number,
    versionNumber: string,
  ) => {
    try {
      const success = await restoreVersion(versionId, true);
      if (success) {
        toast.success(`Restored to version ${versionNumber} as new draft`);
        setIsVersionMenuOpen(false);
      } else {
        toast.error("Failed to restore version");
        console.error("❌ Restore version failed");
      }
    } catch (error) {
      toast.error("Error restoring version");
      console.error("💥 Error in handleRestoreVersion:", error);
    }
  };

  const handleLoadDraft = async (draftId: number) => {
    try {
      const success = await loadDraft(draftId);
      if (success) {
        setIsVersionMenuOpen(false);
      }
    } catch (error) {
      console.error("💥 Error in handleLoadDraft:", error);
    }
  };

  const handleDeleteDraft = async (draftId: number, draftName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the draft "${draftName}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await deleteDraft(draftId);
    } catch (error) {
      console.error("💥 Error in handleDeleteDraft:", error);
    }
  };

  const handleCheckoutVersion = async (
    versionId: number,
    versionNumber: string,
  ) => {
    try {
      const success = await checkoutVersion(versionId, versionNumber);
      if (success) {
        setIsVersionMenuOpen(false);
      }
    } catch (error) {
      console.error("💥 Error in handleCheckoutVersion:", error);
    }
  };

  const publishedVersions = getPublishedVersions();
  const draftVersions = getDraftVersions();

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-blue-900 dark:text-blue-200 font-semibold text-sm">
                Version{" "}
                {checkedOutVersion?.versionNumber ||
                  currentVersion?.versionNumber ||
                  "1"}
              </span>
              {checkedOutVersion?.isDraft && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200"
                >
                  Draft
                </Badge>
              )}
              {checkedOutVersion?.isActive && (
                <Badge
                  variant="default"
                  className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                >
                  Published
                </Badge>
              )}
              {checkedOutVersion && !checkedOutVersion.isActive && (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                >
                  Checked Out
                </Badge>
              )}
            </div>
            {currentVersion?.versionDescription && (
              <span className="text-xs text-blue-700 dark:text-blue-300 truncate max-w-[200px]">
                {currentVersion.versionDescription}
              </span>
            )}
            {!currentVersion?.versionDescription &&
              currentVersion?.createdAt && (
                <span className="text-xs text-blue-600 dark:text-blue-400">
                  Created {formatVersionAge(currentVersion.createdAt)}
                </span>
              )}
          </div>
        </div>

        {hasUnsavedChanges && (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <div className="h-2 w-2 bg-amber-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-medium">Unsaved changes</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsHistoryOpen(true)}
          className="flex items-center gap-2"
          disabled={isLoadingVersions || isLoadingDrafts}
        >
          <History className="h-4 w-4" />
          History ({versions.length + drafts.length})
        </Button>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsVersionMenuOpen(!isVersionMenuOpen)}
            className="flex items-center gap-2"
            disabled={isLoadingVersions}
          >
            <ChevronDown className="h-4 w-4" />
            Switch Version
          </Button>

          {isVersionMenuOpen && (
            <div className="absolute right-0 top-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[300px]">
              <div className="p-3">
                <h3 className="font-semibold text-sm mb-3">
                  Available Versions
                </h3>

                {publishedVersions.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Published Versions
                    </div>
                    <div className="space-y-2">
                      {publishedVersions.map((version) => (
                        <div
                          key={version.id}
                          className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                            version.id === checkedOutVersion?.id
                              ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200"
                              : version.isActive
                                ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20"
                                : "border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium text-sm ${
                                  version.id === checkedOutVersion?.id
                                    ? "text-blue-900 dark:text-blue-200"
                                    : version.isActive
                                      ? "text-green-900 dark:text-green-200"
                                      : "text-gray-900 dark:text-gray-100"
                                }`}
                              >
                                Version {version.versionNumber}
                              </span>
                              {version.id === checkedOutVersion?.id && (
                                <Badge
                                  variant="default"
                                  className="text-xs bg-blue-600"
                                >
                                  <div className="flex items-center gap-1">
                                    <div className="h-1.5 w-1.5 bg-white dark:bg-gray-800 rounded-full animate-pulse"></div>
                                    You're here
                                  </div>
                                </Badge>
                              )}
                              {version.isActive &&
                                version.id !== checkedOutVersion?.id && (
                                  <Badge
                                    variant="default"
                                    className="text-xs bg-green-600"
                                  >
                                    Published
                                  </Badge>
                                )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {formatVersionAge(version.createdAt)} •{" "}
                              {version.questionCount} questions
                            </div>
                            {version.versionDescription && (
                              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                {version.versionDescription}
                              </div>
                            )}
                          </div>
                          {version.id !== checkedOutVersion?.id && (
                            <div className="flex flex-col gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleCheckoutVersion(
                                    version.id,
                                    version.versionNumber,
                                  )
                                }
                                className="text-xs hover:bg-blue-50 hover:border-blue-300"
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                Check it out
                              </Button>
                              <span className="text-xs text-gray-400 dark:text-gray-500 text-center">
                                Switch to this version
                              </span>
                            </div>
                          )}
                          {version.id === checkedOutVersion?.id && (
                            <div className="flex flex-col gap-1 items-center">
                              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium px-2 py-1 bg-blue-100 dark:bg-blue-900/30 rounded">
                                ✓ Current workspace
                              </div>
                              {version.isActive && (
                                <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                                  Published
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {drafts.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
                      My Private Drafts
                    </div>
                    <div className="space-y-2">
                      {drafts.map((draft) => (
                        <div
                          key={draft.id}
                          className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate text-gray-900 dark:text-gray-100">
                                {draft.draftName}
                              </span>
                              <Badge
                                variant="secondary"
                                className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200"
                              >
                                Draft
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {formatVersionAge(draft.updatedAt)} •{" "}
                              {draft.questionCount} questions
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 truncate">
                              Assignment: {draft.assignmentName}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleLoadDraft(draft.id)}
                              className="text-xs hover:bg-green-50 hover:border-green-300 hover:text-green-700"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Load Draft
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleDeleteDraft(draft.id, draft.draftName)
                              }
                              className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 hover:border-red-300 hover:bg-red-50 px-2"
                            >
                              🗑️
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {draftVersions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Legacy Draft Versions
                    </div>
                    <div className="space-y-2">
                      {draftVersions.map((version) => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between p-2 border border-gray-100 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                Draft {version.versionNumber}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                Legacy
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {formatVersionAge(version.createdAt)} •{" "}
                              {version.questionCount} questions
                            </div>
                            {version.versionDescription && (
                              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                {version.versionDescription}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleRestoreVersion(
                                version.id,
                                version.versionNumber,
                              )
                            }
                            className="text-xs"
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Load
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {versions.length === 0 &&
                  drafts.length === 0 &&
                  !isLoadingVersions &&
                  !isLoadingDrafts && (
                    <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                      <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No versions or drafts available</p>
                    </div>
                  )}

                {(isLoadingVersions || isLoadingDrafts) && (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                    <div className="animate-spin h-5 w-5 border-2 border-gray-300 dark:border-gray-600 border-t-gray-600 rounded-full mx-auto mb-2"></div>
                    <p className="text-sm">Loading versions and drafts...</p>
                  </div>
                )}

                {(versionsLoadFailed || draftsLoadFailed) && (
                  <div className="text-center py-4 text-red-500">
                    <p className="text-sm">
                      Failed to load{" "}
                      {versionsLoadFailed && draftsLoadFailed
                        ? "versions and drafts"
                        : versionsLoadFailed
                          ? "versions"
                          : "drafts"}
                    </p>
                    <div className="flex gap-2 justify-center mt-2">
                      {versionsLoadFailed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadVersions()}
                        >
                          Retry Versions
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsVersionMenuOpen(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isVersionMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsVersionMenuOpen(false)}
        />
      )}

      {isHistoryOpen && (
        <VersionHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          versions={versions}
          currentVersion={currentVersion}
          checkedOutVersion={checkedOutVersion}
          onRestoreVersion={handleRestoreVersion}
          onCheckoutVersion={handleCheckoutVersion}
          formatVersionAge={formatVersionAge}
        />
      )}
    </div>
  );
}

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  versions: any[];
  currentVersion?: any;
  checkedOutVersion?: any;
  onRestoreVersion: (versionId: number, versionNumber: string) => Promise<void>;
  onCheckoutVersion: (
    versionId: number,
    versionNumber: string,
  ) => Promise<void>;
  formatVersionAge: (date: string) => string;
}

function VersionHistoryModal({
  isOpen,
  onClose,
  versions,
  currentVersion,
  checkedOutVersion,
  onCheckoutVersion,
  formatVersionAge,
}: VersionHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} Title="Version History">
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="space-y-3">
          {versions.map((version) => (
            <div
              key={version.id}
              className={`p-4 border rounded-lg transition-all ${
                version.id === checkedOutVersion?.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200"
                  : version.isActive
                    ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <GitBranch
                      className={`h-4 w-4 ${
                        version.id === currentVersion?.id
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    />

                    <span
                      className={`font-semibold ${
                        version.id === currentVersion?.id
                          ? "text-blue-900 dark:text-blue-200"
                          : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      Version {version.versionNumber}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {version.id === checkedOutVersion?.id && (
                      <Badge variant="default" className="text-xs bg-blue-600">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-1.5 bg-white dark:bg-gray-800 rounded-full animate-pulse"></div>
                          You're here
                        </div>
                      </Badge>
                    )}
                    {version.isActive &&
                      version.id !== checkedOutVersion?.id && (
                        <Badge
                          variant="default"
                          className="text-xs bg-green-600"
                        >
                          Published
                        </Badge>
                      )}
                    {version.isDraft && (
                      <Badge
                        variant="secondary"
                        className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200"
                      >
                        Draft
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {formatVersionAge(version.createdAt)}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    {version.questionCount} questions
                  </div>
                </div>
              </div>

              {version.versionDescription && (
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {version.versionDescription}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Created by {version.createdBy}
                </div>

                {version.id !== checkedOutVersion?.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onCheckoutVersion(version.id, version.versionNumber)
                    }
                    className="text-xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Check it out
                  </Button>
                )}
                {version.id === checkedOutVersion?.id && (
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-medium px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded">
                    ✓ You're here
                  </div>
                )}
              </div>
            </div>
          ))}

          {versions.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <h3 className="font-medium text-gray-700 dark:text-gray-200 mb-1">
                No Versions Yet
              </h3>
              <p className="text-sm">
                Create your first version by publishing the assignment
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t mt-4">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
