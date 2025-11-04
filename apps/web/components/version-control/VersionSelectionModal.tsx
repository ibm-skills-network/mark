"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  X,
  Tag,
  GitBranch,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  Zap,
  TrendingUp,
  Settings,
} from "lucide-react";
import {
  SemanticVersion,
  VersionSuggestion,
  formatSemanticVersion,
  parseSemanticVersion,
  suggestNextVersion,
  analyzeChanges,
  getLatestVersion,
} from "@/lib/semantic-versioning";
import { VersionComparison } from "@/types/version-types";

interface VersionSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    version: string,
    description: string,
    isDraft: boolean,
    shouldUpdate?: boolean,
    versionId?: number,
  ) => Promise<void>;
  currentVersions: Array<{
    versionNumber: string;
    id?: number;
    isDraft?: boolean;
    isActive?: boolean;
    published?: boolean;
  }>;
  comparison?: VersionComparison;
  isLoading?: boolean;
  workingVersion?: {
    versionNumber: string;
    id?: number;
    isDraft?: boolean;
    isActive?: boolean;
    published?: boolean;
  };
  forcePublish?: boolean;
}

export function VersionSelectionModal({
  isOpen,
  onClose,
  onSave,
  currentVersions,
  comparison,
  isLoading = false,
  workingVersion,
  forcePublish = false,
}: VersionSelectionModalProps) {
  const [selectedVersion, setSelectedVersion] =
    useState<SemanticVersion | null>(null);
  const [customVersion, setCustomVersion] = useState("");
  const [description, setDescription] = useState("");
  const [isDraft, setIsDraft] = useState<boolean | null>(null);
  const [isPersonalDraft, setIsPersonalDraft] = useState<boolean>(false);
  const [shouldUpdate, setShouldUpdate] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<SemanticVersion[]>([]);
  const [changeAnalysis, setChangeAnalysis] =
    useState<VersionSuggestion | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [step, setStep] = useState<"choice" | "details">("choice");

  useEffect(() => {
    if (isOpen) {
      setStep(forcePublish ? "details" : "choice");
      setIsDraft(forcePublish ? false : null);
      setIsPersonalDraft(false);
      setShouldUpdate(false);
      setSelectedVersion(null);
      setCustomVersion("");
      setDescription("");
      setShowCustomInput(false);

      const effectiveComparison = comparison || {
        fromVersion: {
          id: 0,
          versionNumber: "0.0.0",
          versionDescription: "Previous",
          isDraft: false,
          isActive: false,
          published: true,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          questionCount: 0,
          wasAutoIncremented: false,
        },
        toVersion: {
          id: 1,
          versionNumber: "1.0.0",
          versionDescription: "Updated version",
          isDraft: false,
          isActive: true,
          published: false,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          questionCount: 0,
          wasAutoIncremented: false,
        },
        assignmentChanges: [
          {
            field: "instructions",
            fromValue: "previous",
            toValue: "updated",
            changeType: "modified",
          },
        ],

        questionChanges: [],
      };

      const analysis = analyzeChanges(effectiveComparison);
      setChangeAnalysis(analysis);
    }
  }, [isOpen, comparison, currentVersions]);

  useEffect(() => {
    if (changeAnalysis && isDraft !== null && !shouldUpdate) {
      const latestVersion = getLatestVersion(currentVersions);
      const currentVersionString = latestVersion
        ? formatSemanticVersion(latestVersion)
        : "0.0.0";

      const versionSuggestions = suggestNextVersion(
        currentVersionString,
        changeAnalysis,
        isDraft,
      );
      setSuggestions(versionSuggestions);
      setSelectedVersion(versionSuggestions[0] || null);
    } else if (shouldUpdate) {
      const updateableVersions = currentVersions
        .filter((v) => {
          const canUpdate = v.isActive || v.isDraft || v.published;
          return canUpdate;
        })
        .map((v) => {
          try {
            const parsed = parseSemanticVersion(v.versionNumber);

            return {
              ...parsed,
              originalVersion: v,
            };
          } catch (error) {
            console.warn(`Failed to parse version: ${v.versionNumber}`, error);
            return null;
          }
        })
        .filter(
          (v): v is SemanticVersion & { originalVersion: any } => v !== null,
        )
        .sort((a, b) => {
          if (workingVersion) {
            const aIsWorking = a.originalVersion.id === workingVersion.id;
            const bIsWorking = b.originalVersion.id === workingVersion.id;
            if (aIsWorking && !bIsWorking) return -1;
            if (!aIsWorking && bIsWorking) return 1;
          }

          if (a.major !== b.major) return b.major - a.major;
          if (a.minor !== b.minor) return b.minor - a.minor;
          if (a.patch !== b.patch) return b.patch - a.patch;

          if (a.rc && !b.rc) return 1;
          if (!a.rc && b.rc) return -1;
          if (a.rc && b.rc) return b.rc - a.rc;
          return 0;
        });

      setSuggestions(updateableVersions);
      setSelectedVersion(updateableVersions[0] || null);
    }
  }, [changeAnalysis, isDraft, shouldUpdate, currentVersions]);

  const handleSave = async () => {
    if (isPersonalDraft) {
      try {
        const customDraftName =
          description || `Personal draft - ${new Date().toLocaleString()}`;

        const { saveDraft } = await import("@/lib/author");

        const { useAuthorStore } = await import("@/stores/author");
        const { useAssignmentConfig } = await import(
          "@/stores/assignmentConfig"
        );
        const { useAssignmentFeedbackConfig } = await import(
          "@/stores/assignmentFeedbackConfig"
        );

        const authorState = useAuthorStore.getState();
        const assignmentConfigState = useAssignmentConfig.getState();
        const assignmentFeedbackConfigState =
          useAssignmentFeedbackConfig.getState();

        const draftData = {
          draftName: customDraftName,
          assignmentData: {
            name: authorState.name,
            introduction: authorState.introduction,
            instructions: authorState.instructions,
            gradingCriteriaOverview: authorState.gradingCriteriaOverview,
          },
          questionsData: authorState.questions,
        };

        const result = await saveDraft(
          authorState.activeAssignmentId,
          draftData,
        );

        if (result) {
          toast.success("Personal draft saved successfully!");
        } else {
          toast.error("Failed to save personal draft. Please try again.");
        }

        onClose();
        return;
      } catch (error) {
        console.error("Personal draft save error:", error);
        toast.error("Failed to save personal draft. Please try again.");
        return;
      }
    }

    let versionToSave: string;
    let versionIdToUpdate: number | undefined;
    let isUpdatingPublishedVersion = false;

    if (customVersion) {
      versionToSave = customVersion;
    } else if (selectedVersion) {
      versionToSave = formatSemanticVersion(selectedVersion);

      if (shouldUpdate && (selectedVersion as any).originalVersion) {
        const originalVersion = (selectedVersion as any).originalVersion;
        versionIdToUpdate = originalVersion.id;
        isUpdatingPublishedVersion =
          originalVersion.published && !originalVersion.isDraft;
      }
    } else if (suggestions.length > 0) {
      versionToSave = formatSemanticVersion(suggestions[0]);

      if (shouldUpdate && (suggestions[0] as any).originalVersion) {
        const originalVersion = (suggestions[0] as any).originalVersion;
        versionIdToUpdate = originalVersion.id;
        isUpdatingPublishedVersion =
          originalVersion.published && !originalVersion.isDraft;
      }

      toast.success(
        shouldUpdate
          ? `Auto-selected version ${versionToSave} to update`
          : `Auto-selected version ${versionToSave} based on your changes`,
      );
    } else if (!shouldUpdate) {
      console.warn("No version suggestions available, using default version");
      const latestVersion = getLatestVersion(currentVersions);
      const currentVersionString = latestVersion
        ? formatSemanticVersion(latestVersion)
        : "0.0.0";
      const defaultVersion = parseSemanticVersion(currentVersionString);
      versionToSave = `${defaultVersion.major}.${defaultVersion.minor}.${defaultVersion.patch + 1}`;
      toast.success(`Using default version ${versionToSave} based on changes`);
    } else {
      return;
    }

    const effectiveIsDraft = shouldUpdate
      ? isUpdatingPublishedVersion
        ? false
        : true
      : isDraft || false;

    await onSave(
      versionToSave,
      description,
      effectiveIsDraft,
      shouldUpdate,
      versionIdToUpdate,
    );
    onClose();
  };

  const handleSaveAsDraft = async () => {
    if (isPersonalDraft) {
      return handleSave();
    }

    try {
      if (customVersion) {
        await onSave(customVersion, description, true, shouldUpdate);
        onClose();
        return;
      }

      if (selectedVersion) {
        const versionToSave = formatSemanticVersion(selectedVersion);
        await onSave(versionToSave, description, true, shouldUpdate);
        onClose();
        return;
      }

      if (suggestions.length > 0) {
        const autoSelectedVersion = formatSemanticVersion(suggestions[0]);
        toast.success(
          shouldUpdate
            ? `Auto-selected version ${autoSelectedVersion} to update as draft`
            : `Auto-selected version ${autoSelectedVersion}-rc for draft based on your changes`,
        );
        await onSave(autoSelectedVersion, description, true, shouldUpdate);
        onClose();
        return;
      }

      if (!shouldUpdate) {
        console.warn("No version suggestions available, using default version");
        const latestVersion = getLatestVersion(currentVersions);
        const currentVersionString = latestVersion
          ? formatSemanticVersion(latestVersion)
          : "0.0.0";
        const defaultVersion = parseSemanticVersion(currentVersionString);
        const nextPatchVersion = `${defaultVersion.major}.${defaultVersion.minor}.${defaultVersion.patch + 1}-rc1`;
        toast.success(`Using default version ${nextPatchVersion} for draft`);
        await onSave(nextPatchVersion, description, true, shouldUpdate);
        onClose();
        return;
      }
    } catch (error) {
      console.error("Failed to save as draft:", error);
    }
  };

  const handleSaveAndPublish = async () => {
    try {
      if (customVersion) {
        await onSave(customVersion, description, false, shouldUpdate);
        onClose();
        return;
      }

      if (selectedVersion) {
        const versionToSave = formatSemanticVersion(selectedVersion);
        await onSave(versionToSave, description, false, shouldUpdate);
        onClose();
        return;
      }

      if (suggestions.length > 0) {
        const autoSelectedVersion = formatSemanticVersion(suggestions[0]);
        toast.success(
          shouldUpdate
            ? `Auto-selected version ${autoSelectedVersion} to update and publish`
            : `Auto-selected version ${autoSelectedVersion} for publishing based on your changes`,
        );
        await onSave(autoSelectedVersion, description, false, shouldUpdate);
        onClose();
        return;
      }

      if (!shouldUpdate) {
        console.warn("No version suggestions available, using default version");
        const latestVersion = getLatestVersion(currentVersions);
        const currentVersionString = latestVersion
          ? formatSemanticVersion(latestVersion)
          : "0.0.0";
        const defaultVersion = parseSemanticVersion(currentVersionString);
        const nextPatchVersion = `${defaultVersion.major}.${defaultVersion.minor}.${defaultVersion.patch + 1}`;
        toast.success(
          `Using default version ${nextPatchVersion} for publishing`,
        );
        await onSave(nextPatchVersion, description, false, shouldUpdate);
        onClose();
        return;
      }
    } catch (error) {
      console.error("Failed to save and publish:", error);
    }
  };

  const getChangeTypeIcon = (type: "major" | "minor" | "patch") => {
    switch (type) {
      case "major":
        return <Zap className="h-4 w-4 text-red-500" />;
      case "minor":
        return <TrendingUp className="h-4 w-4 text-blue-500" />;
      case "patch":
        return <Settings className="h-4 w-4 text-green-500" />;
    }
  };

  const getChangeTypeColor = (type: "major" | "minor" | "patch") => {
    switch (type) {
      case "major":
        return "border-red-200 bg-red-50 text-red-700";
      case "minor":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "patch":
        return "border-green-200 bg-green-50 text-green-700";
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onClose}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 400 }}
              className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                      <Tag className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        Save Your Changes
                      </h2>
                      <p className="text-sm text-gray-500">
                        Choose how you want to save your work
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={onClose}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X className="h-5 w-5 text-gray-400" />
                    </button>
                  </div>
                </div>

                {step === "choice" ? (
                  <div>
                    {changeAnalysis && (
                      <div
                        className={`p-4 rounded-lg border mb-6 ${getChangeTypeColor(changeAnalysis.changeType)}`}
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          {getChangeTypeIcon(changeAnalysis.changeType)}
                          <span className="font-medium capitalize">
                            {changeAnalysis.changeType} Changes Detected
                          </span>
                        </div>
                        <p className="text-sm">{changeAnalysis.reason}</p>
                      </div>
                    )}

                    <div className="space-y-4 mb-8">
                      <h3 className="font-medium text-gray-900 mb-4">
                        Choose how to save your changes:
                      </h3>

                      <motion.button
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        onClick={() => {
                          setIsDraft(true);
                          setIsPersonalDraft(true);
                          setShouldUpdate(false);
                          setStep("details");
                        }}
                        className="w-full p-6 rounded-lg border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 text-left transition-all group"
                      >
                        <div className="flex items-start space-x-4">
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-2">
                              Save as Personal Draft
                            </h4>
                            <p className="text-gray-700 mb-3">
                              Save your work in progress privately. Perfect when
                              you're not ready to share with the team yet.
                            </p>
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <span className="font-medium">
                                • Private to you only
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <span className="font-medium">
                                • Can continue editing anytime
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <span className="font-medium">
                                • Not visible to team members
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.button>

                      <motion.button
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        onClick={() => {
                          setIsDraft(true);
                          setIsPersonalDraft(false);
                          setShouldUpdate(false);
                          setStep("details");
                        }}
                        className="w-full p-6 rounded-lg border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 text-left transition-all group"
                      >
                        <div className="flex items-start space-x-4">
                          <div>
                            <h4 className="text-lg font-semibold text-amber-900 mb-2">
                              Create Draft Version
                            </h4>
                            <p className="text-amber-700 mb-3">
                              Create a version that's ready to become the next
                              published version. One step away from going live.
                            </p>
                            <div className="flex items-center space-x-2 text-sm text-amber-600">
                              <span className="font-medium">
                                • Adds -rc suffix (e.g., v2.1.0-rc1)
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-amber-600">
                              <span className="font-medium">
                                • Visible to team for review
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-amber-600">
                              <span className="font-medium">
                                • Ready for publishing workflow
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.button>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <span className="font-medium">Selected approach:</span>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            shouldUpdate
                              ? "bg-green-100 text-green-700"
                              : isDraft
                                ? isPersonalDraft
                                  ? "bg-gray-100 text-gray-700"
                                  : "bg-amber-100 text-amber-700"
                                : "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {shouldUpdate
                            ? "Update Existing Version"
                            : isDraft
                              ? isPersonalDraft
                                ? "Personal Draft"
                                : "Draft Version"
                              : "Published Version"}
                        </span>
                      </div>
                    </div>

                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-medium text-gray-900">
                          {shouldUpdate
                            ? "Select Version to Update"
                            : isDraft
                              ? isPersonalDraft
                                ? "Personal Draft Settings"
                                : "Draft Version Suggestions"
                              : "Published Version Suggestions"}
                        </h3>
                      </div>

                      <div className="space-y-3">
                        {isPersonalDraft ? (
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <span className="font-medium">
                                Personal drafts don't require version numbers -
                                your work will be saved privately for you to
                                continue later.
                              </span>
                            </div>
                          </div>
                        ) : (
                          suggestions.map((version, index) => (
                            <motion.button
                              key={`${version.major}.${version.minor}.${version.patch}`}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.1 }}
                              onClick={() => {
                                setSelectedVersion(version);
                                setCustomVersion("");
                              }}
                              className={`w-full p-4 rounded-lg border text-left transition-all ${
                                selectedVersion === version
                                  ? "border-indigo-300 bg-indigo-50 shadow-sm"
                                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="flex items-center space-x-2">
                                    <GitBranch className="h-4 w-4 text-indigo-500" />
                                    <span className="font-mono font-medium text-lg">
                                      v{formatSemanticVersion(version)}
                                    </span>
                                  </div>
                                  {index === 0 && !shouldUpdate && (
                                    <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium">
                                      Recommended
                                    </span>
                                  )}
                                  {shouldUpdate &&
                                    workingVersion &&
                                    (version as any).originalVersion?.id ===
                                      workingVersion.id && (
                                      <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                        Current Working
                                      </span>
                                    )}
                                  {version.rc && (
                                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                                      Draft
                                    </span>
                                  )}
                                  {shouldUpdate && (
                                    <>
                                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                                        Can Update
                                      </span>

                                      {(version as any).originalVersion
                                        ?.isDraft && (
                                        <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                                          Will Create New
                                        </span>
                                      )}

                                      {(version as any).originalVersion
                                        ?.published &&
                                        !(version as any).originalVersion
                                          ?.isDraft && (
                                          <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                                            Will Publish
                                          </span>
                                        )}
                                    </>
                                  )}
                                </div>
                                {selectedVersion === version && (
                                  <CheckCircle className="h-5 w-5 text-indigo-500" />
                                )}
                              </div>
                            </motion.button>
                          ))
                        )}

                        {!isPersonalDraft && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-4 border border-gray-200 rounded-lg"
                          >
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Custom Version (e.g.,{" "}
                              {isDraft ? "1.0.0-rc1" : "1.0.0"})
                            </label>
                            <input
                              type="text"
                              value={customVersion}
                              onChange={(e) => {
                                setCustomVersion(e.target.value);
                                setSelectedVersion(null);
                              }}
                              placeholder={isDraft ? "1.0.0-rc1" : "1.0.0"}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                            />
                          </motion.div>
                        )}
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Version Description
                      </label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe what changed in this version..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    {!customVersion &&
                      !selectedVersion &&
                      suggestions.length > 0 && (
                        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="flex items-center space-x-2 text-sm text-blue-700">
                            <AlertCircle className="h-4 w-4" />
                            <span>
                              <strong>Auto-selection:</strong> Will use{" "}
                              <code className="bg-blue-100 px-1 rounded font-mono">
                                v{formatSemanticVersion(suggestions[0])}
                              </code>{" "}
                              if no version is selected
                              {shouldUpdate &&
                                (suggestions[0] as any).originalVersion
                                  ?.published &&
                                !(suggestions[0] as any).originalVersion
                                  ?.isDraft && (
                                  <span className="block mt-1 font-medium text-blue-800">
                                    ⚠️ This will trigger the full publish
                                    process since it's updating a published
                                    version.
                                  </span>
                                )}
                            </span>
                          </div>
                        </div>
                      )}

                    {shouldUpdate &&
                      selectedVersion &&
                      (selectedVersion as any).originalVersion?.published &&
                      !(selectedVersion as any).originalVersion?.isDraft && (
                        <div className="mb-6 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                          <div className="flex items-center space-x-2 text-sm text-orange-700">
                            <AlertCircle className="h-4 w-4" />
                            <span>
                              <strong>Publishing Notice:</strong> You're
                              updating a published version. This will trigger
                              the full publish process to ensure the changes are
                              properly deployed.
                            </span>
                          </div>
                        </div>
                      )}

                    {shouldUpdate &&
                      selectedVersion &&
                      (selectedVersion as any).originalVersion?.isDraft && (
                        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-center space-x-2 text-sm text-amber-700">
                            <AlertCircle className="h-4 w-4" />
                            <span>
                              <strong>Draft Update Notice:</strong> Updating a
                              draft/RC version will create a new version with
                              your changes. The original draft will remain
                              unchanged.
                            </span>
                          </div>
                        </div>
                      )}

                    <div className="flex items-center justify-between">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>

                      <button
                        onClick={
                          shouldUpdate
                            ? handleSave
                            : isDraft
                              ? handleSaveAsDraft
                              : handleSaveAndPublish
                        }
                        disabled={isLoading}
                        className={`flex items-center space-x-2 px-6 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                          shouldUpdate
                            ? "bg-green-600 hover:bg-green-700"
                            : isDraft
                              ? isPersonalDraft
                                ? "bg-gray-600 hover:bg-gray-700"
                                : "bg-amber-600 hover:bg-amber-700"
                              : "bg-indigo-600 hover:bg-indigo-700"
                        }`}
                      >
                        {isLoading && (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        )}
                        <span>
                          {shouldUpdate
                            ? "Update Version"
                            : isDraft
                              ? isPersonalDraft
                                ? "Save Personal Draft"
                                : "Create Draft Version"
                              : "Create and Publish"}
                        </span>
                        {!isDraft && !shouldUpdate && (
                          <ArrowRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
