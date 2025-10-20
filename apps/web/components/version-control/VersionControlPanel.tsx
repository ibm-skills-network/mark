"use client";

import React, { useState, useEffect } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Modal from "@/components/Modal";
import {
  Save,
  GitBranch,
  Clock,
  RotateCcw,
  Plus,
  Eye,
  ChevronDown,
  History,
} from "lucide-react";
import { toast } from "sonner";

interface VersionControlPanelProps {
  onSave: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  className?: string;
}

export function VersionControlPanel({
  onSave,
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
    // Draft functionality
    drafts,
    isLoadingDrafts,
    draftsLoadFailed,
    loadDraft,
    deleteDraft,
  } = useVersionControl();

  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load versions on mount - removed since useVersionControl hook handles this automatically

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const success = await onSave();
      if (success) {
        toast.success("Changes saved successfully");
        // Reload versions to show the new draft
        await loadVersions();
      } else {
        toast.error("Failed to save changes");
      }
    } catch (error) {
      toast.error("Error saving changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = async (
    versionId: number,
    versionNumber: string,
  ) => {
    try {
      const success = await restoreVersion(versionId, true);
      if (success) {
        toast.success(`Restored to version ${versionNumber} as new draft`);
        setIsVersionMenuOpen(false);
        // No need to reload - the store has been updated with the restored data
      } else {
        toast.error("Failed to restore version");
        console.error("❌ Restore version failed");
      }
    } catch (error) {
      toast.error("Error restoring version");
      console.error("💥 Error in handleRestoreVersion:", error);
    }
  };

  const handleLoadDraft = async (draftId: number, draftName: string) => {
    try {
      const success = await loadDraft(draftId);
      if (success) {
        setIsVersionMenuOpen(false);
        // Don't reload drafts - loadDraft already handles the data loading
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
      const success = await deleteDraft(draftId);
      if (success) {
        // No need to reload - deleteDraft already updates local state
      }
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
      {/* Enhanced Current Version Display */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <GitBranch className="h-4 w-4 text-blue-600" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-blue-900 font-semibold text-sm">
                Version{" "}
                {checkedOutVersion?.versionNumber ||
                  currentVersion?.versionNumber ||
                  "1"}
              </span>
              {checkedOutVersion?.isDraft && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-yellow-100 text-yellow-800"
                >
                  Draft
                </Badge>
              )}
              {checkedOutVersion?.isActive && (
                <Badge
                  variant="default"
                  className="text-xs bg-green-100 text-green-800"
                >
                  Published
                </Badge>
              )}
              {checkedOutVersion && !checkedOutVersion.isActive && (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-300 text-blue-700"
                >
                  Checked Out
                </Badge>
              )}
            </div>
            {currentVersion?.versionDescription && (
              <span className="text-xs text-blue-700 truncate max-w-[200px]">
                {currentVersion.versionDescription}
              </span>
            )}
            {!currentVersion?.versionDescription &&
              currentVersion?.createdAt && (
                <span className="text-xs text-blue-600">
                  Created {formatVersionAge(currentVersion.createdAt)}
                </span>
              )}
          </div>
        </div>

        {/* Unsaved Changes Indicator */}
        {hasUnsavedChanges && (
          <div className="flex items-center gap-1 text-amber-600">
            <div className="h-2 w-2 bg-amber-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-medium">Unsaved changes</span>
          </div>
        )}
      </div>

      {/* Version Actions */}
      <div className="flex items-center gap-2">
        {/* Version History */}
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

        {/* Version Menu */}
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
            <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[300px]">
              <div className="p-3">
                <h3 className="font-semibold text-sm mb-3">
                  Available Versions
                </h3>

                {/* Published Versions */}
                {publishedVersions.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                      Published Versions
                    </div>
                    <div className="space-y-2">
                      {publishedVersions.map((version) => (
                        <div
                          key={version.id}
                          className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                            version.id === checkedOutVersion?.id
                              ? "border-blue-300 bg-blue-50 ring-2 ring-blue-200"
                              : version.isActive
                                ? "border-green-300 bg-green-50"
                                : "border-gray-100 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium text-sm ${
                                  version.id === checkedOutVersion?.id
                                    ? "text-blue-900"
                                    : version.isActive
                                      ? "text-green-900"
                                      : "text-gray-900"
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
                                    <div className="h-1.5 w-1.5 bg-white rounded-full animate-pulse"></div>
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
                            <div className="text-xs text-gray-500 mt-1">
                              {formatVersionAge(version.createdAt)} •{" "}
                              {version.questionCount} questions
                            </div>
                            {version.versionDescription && (
                              <div className="text-xs text-gray-600 mt-1">
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
                              <span className="text-xs text-gray-400 text-center">
                                Switch to this version
                              </span>
                            </div>
                          )}
                          {version.id === checkedOutVersion?.id && (
                            <div className="flex flex-col gap-1 items-center">
                              <div className="text-xs text-blue-600 font-medium px-2 py-1 bg-blue-100 rounded">
                                ✓ Current workspace
                              </div>
                              {version.isActive && (
                                <div className="text-xs text-green-600 font-medium">
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

                {/* User Drafts */}
                {drafts.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                      My Private Drafts
                    </div>
                    <div className="space-y-2">
                      {drafts.map((draft) => (
                        <div
                          key={draft.id}
                          className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate text-gray-900">
                                {draft.draftName}
                              </span>
                              <Badge
                                variant="secondary"
                                className="text-xs bg-yellow-100 text-yellow-800"
                              >
                                Draft
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {formatVersionAge(draft.updatedAt)} •{" "}
                              {draft.questionCount} questions
                            </div>
                            <div className="text-xs text-gray-600 mt-1 truncate">
                              Assignment: {draft.assignmentName}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleLoadDraft(draft.id, draft.draftName)
                              }
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
                              className="text-xs text-red-600 hover:text-red-700 hover:border-red-300 hover:bg-red-50 px-2"
                            >
                              🗑️
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Draft Versions (from old version system) */}
                {draftVersions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                      Legacy Draft Versions
                    </div>
                    <div className="space-y-2">
                      {draftVersions.map((version) => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between p-2 border border-gray-100 rounded hover:bg-gray-50"
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
                            <div className="text-xs text-gray-500">
                              {formatVersionAge(version.createdAt)} •{" "}
                              {version.questionCount} questions
                            </div>
                            {version.versionDescription && (
                              <div className="text-xs text-gray-600 mt-1">
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
                    <div className="text-center py-4 text-gray-500">
                      <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No versions or drafts available</p>
                    </div>
                  )}

                {(isLoadingVersions || isLoadingDrafts) && (
                  <div className="text-center py-4 text-gray-500">
                    <div className="animate-spin h-5 w-5 border-2 border-gray-300 border-t-gray-600 rounded-full mx-auto mb-2"></div>
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

      {/* Click outside to close version menu */}
      {isVersionMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsVersionMenuOpen(false)}
        />
      )}

      {/* Version History Modal */}
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
  onRestoreVersion,
  onCheckoutVersion,
  formatVersionAge,
}: VersionHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} Title="Version History">
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="space-y-3">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className={`p-4 border rounded-lg transition-all ${
                version.id === checkedOutVersion?.id
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                  : version.isActive
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <GitBranch
                      className={`h-4 w-4 ${
                        version.id === currentVersion?.id
                          ? "text-blue-600"
                          : "text-gray-400"
                      }`}
                    />
                    <span
                      className={`font-semibold ${
                        version.id === currentVersion?.id
                          ? "text-blue-900"
                          : "text-gray-900"
                      }`}
                    >
                      Version {version.versionNumber}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {version.id === checkedOutVersion?.id && (
                      <Badge variant="default" className="text-xs bg-blue-600">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-1.5 bg-white rounded-full animate-pulse"></div>
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
                        className="text-xs bg-yellow-100 text-yellow-800"
                      >
                        Draft
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm text-gray-500">
                    {formatVersionAge(version.createdAt)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {version.questionCount} questions
                  </div>
                </div>
              </div>

              {version.versionDescription && (
                <div className="mt-2 text-sm text-gray-600">
                  {version.versionDescription}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-gray-500">
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
                  <div className="text-xs text-blue-600 font-medium px-3 py-1 bg-blue-100 rounded">
                    ✓ You're here
                  </div>
                )}
              </div>
            </div>
          ))}

          {versions.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <h3 className="font-medium text-gray-700 mb-1">
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
