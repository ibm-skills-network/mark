"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
    saveDraft,
    checkoutVersion,
    activateVersion,
    formatVersionAge,
    getDraftVersions,
    getPublishedVersions,
    // Draft functionality
    drafts,
    isLoadingDrafts,
    draftsLoadFailed,
    loadDrafts,
    loadDraft,
    deleteDraft,
    hasUnsavedChanges,
  } = useVersionControl();

  // Modal states
  const [isCreateVersionModalOpen, setIsCreateVersionModalOpen] =
    useState(false);
  const [isCreateDraftModalOpen, setIsCreateDraftModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // Form states
  const [versionDescription, setVersionDescription] = useState("");
  const [draftName, setDraftName] = useState("");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const publishedVersions = getPublishedVersions();
  const draftVersions = getDraftVersions();

  const handleCreateVersion = async () => {
    if (!versionDescription.trim()) {
      toast.error("Please enter a version description");
      return;
    }

    setIsCreatingVersion(true);
    try {
      const newVersion = await createVersion(versionDescription, false);
      if (newVersion) {
        setIsCreateVersionModalOpen(false);
        setVersionDescription("");
        toast.success("Version created successfully!");
      }
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!draftName.trim()) {
      toast.error("Please enter a draft name");
      return;
    }

    setIsCreatingDraft(true);
    try {
      const newDraft = await saveDraft(draftName);
      if (newDraft) {
        setIsCreateDraftModalOpen(false);
        setDraftName("");
        toast.success("Draft saved successfully!");
        await loadDrafts(); // Reload drafts
      }
    } finally {
      setIsCreatingDraft(false);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Version Control</h2>
          <p className="text-muted-foreground">
            Manage versions, drafts, and track changes to your assignment
          </p>
        </div>
      </div>

      {/* Current Status */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center space-x-2 rounded-lg border p-4">
          <GitBranch className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium">Current Workspace</p>
            <p className="text-2xl font-bold text-blue-600">
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
          <Activity className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Published Version</p>
            <p className="text-2xl font-bold text-green-600">
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
          <FileText className="h-5 w-5 text-yellow-600" />
          <div>
            <p className="text-sm font-medium">My Private Drafts</p>
            <p className="text-2xl font-bold text-yellow-600">
              {drafts.length}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasUnsavedChanges ? "Unsaved changes" : "All saved"}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button
          onClick={() => setIsCreateDraftModalOpen(true)}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          Save as Draft
        </Button>

        <Button
          onClick={() => setIsCreateVersionModalOpen(true)}
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

      {/* Version History */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Version History</h3>

        {isLoadingVersions ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-gray-600 rounded-full"></div>
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
                      ? "border-blue-300 bg-blue-50 ring-2 ring-blue-200"
                      : version.isActive
                        ? "border-green-300 bg-green-50"
                        : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-gray-400" />
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
                        <p className="text-sm text-gray-600 mt-1">
                          {version.versionDescription || "No description"}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
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
                          className="text-green-600 hover:text-green-700"
                        >
                          Make Active
                        </Button>
                      )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
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

      {/* Drafts Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">My Private Drafts</h3>

        {isLoadingDrafts ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-gray-600 rounded-full"></div>
          </div>
        ) : drafts.length > 0 ? (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
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
                      <p className="text-sm text-gray-600 mt-1">
                        Assignment: {draft.assignmentName}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
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
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No drafts yet</p>
            <p className="text-sm">
              Save your work as drafts to experiment with changes
            </p>
          </div>
        )}
      </div>

      {/* Create Version Modal */}
      {isCreateVersionModalOpen && (
        <Modal
          onClose={() => setIsCreateVersionModalOpen(false)}
          Title="Create New Version"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Version Description
              </label>
              <textarea
                value={versionDescription}
                onChange={(e) => setVersionDescription(e.target.value)}
                placeholder="Describe the changes in this version..."
                className="w-full p-3 border border-gray-300 rounded-md resize-none"
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
                {isCreatingVersion ? "Creating..." : "Create Version"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Draft Modal */}
      {isCreateDraftModalOpen && (
        <Modal
          onClose={() => setIsCreateDraftModalOpen(false)}
          Title="Save as Draft"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Draft Name
              </label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Enter a name for this draft..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsCreateDraftModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateDraft}
                disabled={isCreatingDraft || !draftName.trim()}
              >
                {isCreatingDraft ? "Saving..." : "Save Draft"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
