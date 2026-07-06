"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Modal from "@/components/Modal";
import {
  Save,
  GitBranch,
  Eye,
  History,
  FileText,
  Trash2,
  GitCommit,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

export function VersionControlTab() {
  const {
    versions,
    currentVersion,
    checkedOutVersion,
    isLoadingVersions,
    versionsLoadFailed,
    loadVersions,
    createVersion,
    checkoutVersion,
    activateVersion,
    formatVersionAge,
    drafts,
    isLoadingDrafts,
    loadDraft,
    deleteDraft,
    hasUnsavedChanges,
  } = useVersionControl();

  const [isCreateVersionModalOpen, setIsCreateVersionModalOpen] =
    useState(false);
  const [creationMode, setCreationMode] = useState<"draft" | "version">(
    "version",
  );
  const [versionDescription, setVersionDescription] = useState("");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const handleCreateVersion = async () => {
    if (!versionDescription.trim()) {
      toast.error("Please enter a version description");
      return;
    }

    setIsCreatingVersion(true);
    try {
      const isDraft = creationMode === "draft";
      const newVersion = await createVersion(versionDescription, isDraft);
      if (newVersion) {
        setIsCreateVersionModalOpen(false);
        setVersionDescription("");
        toast.success(
          isDraft
            ? "Draft saved successfully!"
            : "Version created successfully!",
        );
      }
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const handleCheckout = async (versionId: number, versionNumber: string) => {
    await checkoutVersion(versionId, versionNumber);
  };

  const handleDeleteDraft = async (draftId: number, draftName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the draft "${draftName}"? This action cannot be undone.`,
      )
    ) {
      return;
    }
    await deleteDraft(draftId);
  };

  const handleActivateVersion = async (
    versionId: number,
    versionNumber: string,
  ) => {
    if (
      !window.confirm(
        `Are you sure you want to make version ${versionNumber} the active/published version?`,
      )
    ) {
      return;
    }
    await activateVersion(versionId);
  };

  return (
    <div className="space-y-6 mt-28 px-4 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Version Control</h2>
          <p className="text-muted-foreground">
            Manage versions, drafts, and track changes to your assignment
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center space-x-2 rounded-lg border p-4">
          <GitBranch className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-sm font-medium">Current Workspace</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              Version{" "}
              {checkedOutVersion?.versionNumber ||
                currentVersion?.versionNumber ||
                "1"}
            </p>
            <p className="text-xs text-muted-foreground">
              {checkedOutVersion?.isActive
                ? "Published"
                : checkedOutVersion
                  ? "Checked out"
                  : "Active"}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 rounded-lg border p-4">
          <Activity className="h-5 w-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="text-sm font-medium">Published Version</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              Version {currentVersion?.versionNumber || "1"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatVersionAge(
                currentVersion?.createdAt || new Date().toISOString(),
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 rounded-lg border p-4">
          <FileText className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          <div>
            <p className="text-sm font-medium">My Private Drafts</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {drafts.length}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasUnsavedChanges ? "Unsaved changes" : "All saved"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={() => {
            setCreationMode("draft");
            setIsCreateVersionModalOpen(true);
          }}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          Save as Draft
        </Button>

        <Button
          onClick={() => {
            setCreationMode("version");
            setIsCreateVersionModalOpen(true);
          }}
          variant="outline"
          className="flex items-center gap-2"
        >
          <GitCommit className="h-4 w-4" />
          Create Version
        </Button>

        <Button
          onClick={() => loadVersions()}
          variant="ghost"
          className="flex items-center gap-2"
          disabled={isLoadingVersions}
        >
          <History className="h-4 w-4" />
          {isLoadingVersions ? "Loading..." : "Refresh"}
        </Button>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Version History</h3>

        {isLoadingVersions ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-gray-300 dark:border-gray-600 border-t-gray-600 rounded-full"></div>
          </div>
        ) : versionsLoadFailed ? (
          <div className="text-center py-8 text-red-500">
            <p>Failed to load versions</p>
            <Button
              onClick={() => loadVersions()}
              variant="outline"
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.length > 0 ? (
              versions.map((version) => (
                <div
                  key={version.id}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                    version.id === checkedOutVersion?.id
                      ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200"
                      : version.isActive
                        ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            Version {version.versionNumber}
                          </span>
                          {version.id === checkedOutVersion?.id && (
                            <Badge
                              variant="default"
                              className="text-xs bg-blue-600"
                            >
                              You're here
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
                            <Badge variant="secondary" className="text-xs">
                              Draft
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                          {version.versionDescription || "No description"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {formatVersionAge(version.createdAt)} •{" "}
                          {version.questionCount} questions • by{" "}
                          {version.createdBy}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {version.id !== checkedOutVersion?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleCheckout(version.id, version.versionNumber)
                        }
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Check it out
                      </Button>
                    )}
                    {!version.isActive &&
                      version.id !== checkedOutVersion?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleActivateVersion(
                              version.id,
                              version.versionNumber,
                            )
                          }
                          className="text-green-600 dark:text-green-400 hover:text-green-700"
                        >
                          Make Active
                        </Button>
                      )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No versions yet</p>
                <p className="text-sm">
                  Create your first version to start tracking changes
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">My Private Drafts</h3>

        {isLoadingDrafts ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-gray-300 dark:border-gray-600 border-t-gray-600 rounded-full"></div>
          </div>
        ) : drafts.length > 0 ? (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-yellow-500" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{draft.draftName}</span>
                        <Badge variant="secondary" className="text-xs">
                          Draft
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                        Assignment: {draft.assignmentName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatVersionAge(draft.updatedAt)} •{" "}
                        {draft.questionCount} questions
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadDraft(draft.id)}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Load
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteDraft(draft.id, draft.draftName)}
                    className="text-red-600 dark:text-red-400 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No drafts yet</p>
            <p className="text-sm">
              Save your work as drafts to experiment with changes
            </p>
          </div>
        )}
      </div>

      {isCreateVersionModalOpen && (
        <Modal
          onClose={() => setIsCreateVersionModalOpen(false)}
          Title={
            creationMode === "draft"
              ? "Save Draft Version"
              : "Create New Version"
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                {creationMode === "draft"
                  ? "Draft Description"
                  : "Version Description"}
              </label>
              <textarea
                value={versionDescription}
                onChange={(e) => setVersionDescription(e.target.value)}
                placeholder={
                  creationMode === "draft"
                    ? "Describe this draft so you can find it later..."
                    : "Describe the changes in this version..."
                }
                className="w-full p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 rounded-md resize-none"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsCreateVersionModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateVersion}
                disabled={isCreatingVersion || !versionDescription.trim()}
              >
                {isCreatingVersion
                  ? creationMode === "draft"
                    ? "Saving..."
                    : "Creating..."
                  : creationMode === "draft"
                    ? "Save Draft"
                    : "Create Version"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
