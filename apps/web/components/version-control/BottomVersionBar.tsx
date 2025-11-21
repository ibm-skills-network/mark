"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { useRouter } from "next/navigation";
import { useAuthorStore } from "@/stores/author";
import { UnsavedChangesModal } from "./UnsavedChangesModal";
import { VersionSelectionModal } from "./VersionSelectionModal";
import { useChatbot } from "@/hooks/useChatbot";
import { VersionComparison } from "@/types/version-types";
import {
  ChevronUp,
  GitBranch,
  Clock,
  Eye,
  FileText,
  GitMerge,
  Tag,
  Star,
  User,
  Activity,
  TrendingUp,
  CheckCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}

function Dropdown({
  isOpen,
  onClose,
  children,
  width = "auto",
}: DropdownProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 400 }}
            className="absolute bottom-full mb-3 left-0 right-0 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200/60 z-50 max-h-80 overflow-hidden"
            style={{ width }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-white/20 pointer-events-none" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function BottomVersionBar() {
  const { isOpen: isChatbotOpen } = useChatbot();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionComparison, setVersionComparison] =
    useState<VersionComparison | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    type: "checkout" | "loadDraft";
    versionId?: number;
    versionNumber?: string | number;
    draftId?: number;
    targetName?: string;
  } | null>(null);
  const router = useRouter();
  const activeAssignmentId = useAuthorStore(
    (state) => state.activeAssignmentId,
  );
  const favoriteVersions = useAuthorStore(
    (state) => state.favoriteVersions || [],
  );
  const isVersionFavorite = (versionId: number) =>
    favoriteVersions.includes(versionId);

  const toggleFavoriteVersion = (versionId: number) => {
    useAuthorStore.setState((state) => {
      const isFavorite = state.favoriteVersions.includes(versionId);
      const newFavorites = isFavorite
        ? state.favoriteVersions.filter((id) => id !== versionId)
        : [...state.favoriteVersions, versionId];

      return { favoriteVersions: newFavorites };
    });
  };

  const versionControlHook = useVersionControl();
  const {
    versions,
    currentVersion,
    checkedOutVersion,
    checkoutVersion,
    formatVersionAge,
    hasUnsavedChanges,
    createVersion,
    updateExistingVersion,
    drafts,
    loadDraft,
    isLoadingDrafts,
    draftsLoadFailed,
    hasAttemptedLoadDrafts,
    forceRefreshDrafts,
    debugForceStateRefresh,
    forceClearLoadingState,
    loadVersions,
    isLoadingVersions,
    versionsLoadFailed,
    compareVersions,
  } = versionControlHook;

  React.useEffect(() => {
    if (activeAssignmentId && isLoadingVersions) {
      const timeout = setTimeout(() => {
        loadVersions().catch(console.error);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [activeAssignmentId, isLoadingVersions, loadVersions]);

  const getVersionQuestionCount = (version: any) => {
    return version?.questionVersions?.length || version?.questionCount || 0;
  };

  const workingVersion =
    checkedOutVersion ||
    currentVersion ||
    (versions.length > 0 ? versions[0] : null);
  const isWorkingOnLatest =
    !checkedOutVersion || checkedOutVersion?.id === currentVersion?.id;

  const handleVersionSelect = async (
    versionId: number,
    versionNumber: string | number,
  ) => {
    if (hasUnsavedChanges) {
      setPendingAction({
        type: "checkout",
        versionId,
        versionNumber,
        targetName: `v${versionNumber}`,
      });
      setShowUnsavedModal(true);
      return;
    }

    const result = await checkoutVersion(versionId, versionNumber);
    setVersionsOpen(false);
  };

  const handleDraftSelect = async (draftId: number) => {
    const draft = drafts.find((d) => d.id === draftId);

    if (hasUnsavedChanges) {
      setPendingAction({
        type: "loadDraft",
        draftId,
        targetName: draft?.name || "Draft",
      });
      setShowUnsavedModal(true);
      return;
    }

    await loadDraft(draftId);
    setDraftsOpen(false);
  };

  const handleSaveAndProceed = async () => {
    try {
      if (pendingAction) {
        if (
          pendingAction.type === "checkout" &&
          pendingAction.versionId &&
          pendingAction.versionNumber !== undefined
        ) {
          await checkoutVersion(
            pendingAction.versionId,
            pendingAction.versionNumber,
          );
          setVersionsOpen(false);
        } else if (
          pendingAction.type === "loadDraft" &&
          pendingAction.draftId
        ) {
          await loadDraft(pendingAction.draftId);
          setDraftsOpen(false);
        }
      }
    } catch (error) {
      console.error("Failed to save before proceeding:", error);
    } finally {
      setShowUnsavedModal(false);
      setPendingAction(null);
    }
  };

  const handleProceedWithoutSaving = async () => {
    if (pendingAction) {
      if (
        pendingAction.type === "checkout" &&
        pendingAction.versionId &&
        pendingAction.versionNumber !== undefined
      ) {
        await checkoutVersion(
          pendingAction.versionId,
          pendingAction.versionNumber,
        );
        setVersionsOpen(false);
      } else if (pendingAction.type === "loadDraft" && pendingAction.draftId) {
        await loadDraft(pendingAction.draftId);
        setDraftsOpen(false);
      }
    }

    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  const handleModalClose = () => {
    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  const handleRevertChanges = () => {
    if (
      confirm(
        "Are you sure you want to revert all unsaved changes? This action cannot be undone.",
      )
    ) {
      window.location.reload();
    }
  };

  const handleVersionSave = async (
    versionNumber: string,
    description: string,
    isDraft: boolean,
    shouldUpdate?: boolean,
    versionId?: number,
  ) => {
    try {
      if (shouldUpdate && versionId) {
        if (updateExistingVersion) {
          await updateExistingVersion(
            versionId,
            versionNumber,
            description,
            isDraft,
          );
        }
      } else if (createVersion) {
        await createVersion(description, isDraft, versionNumber, shouldUpdate);
      }
    } catch (error) {
      console.error("Failed to save version:", error);
      throw error;
    }
  };

  const getVersionStatus = () => {
    if (hasUnsavedChanges) return "modified";
    if (!isWorkingOnLatest) return "checkout";
    return "current";
  };

  const getStatusColor = () => {
    const status = getVersionStatus();
    switch (status) {
      case "modified":
        return "bg-amber-500";
      case "checkout":
        return "bg-blue-500";
      default:
        return "bg-green-500";
    }
  };

  const getStatusText = () => {
    const status = getVersionStatus();
    switch (status) {
      case "modified":
        return "Modified";
      case "checkout":
        return "Checked Out";
      default:
        return "Current";
    }
  };

  if (isLoadingVersions) {
    return (
      <div
        className={`fixed bottom-0 left-0 bg-white/95 backdrop-blur-md border-t border-gray-200/60 px-6 py-3 z-40 shadow-lg transition-all duration-300 ease-in-out ${
          isChatbotOpen ? "right-[25vw]" : "right-0"
        }`}
      >
        <div className="flex items-center justify-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
            <span className="text-sm font-medium text-gray-600">
              Loading version information...
            </span>
          </div>
          <button
            onClick={() => {
              loadVersions().catch(console.error);
            }}
            className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (versionsLoadFailed) {
    return (
      <div
        className={`fixed bottom-0 left-0 bg-white/95 backdrop-blur-md border-t border-gray-200/60 px-6 py-3 z-40 shadow-lg transition-all duration-300 ease-in-out ${
          isChatbotOpen ? "right-[25vw]" : "right-0"
        }`}
      >
        <div className="flex items-center justify-center">
          <div className="text-red-500">⚠️</div>
          <span className="ml-3 text-sm font-medium text-red-600">
            Failed to load version information
          </span>
        </div>
      </div>
    );
  }

  if (!workingVersion && activeAssignmentId) {
    return (
      <div
        className={`fixed bottom-0 left-0 bg-white/95 backdrop-blur-md border-t border-gray-200/60 px-6 py-3 z-40 shadow-lg transition-all duration-300 ease-in-out ${
          isChatbotOpen ? "right-[25vw]" : "right-0"
        }`}
      >
        <div className="flex items-center justify-center">
          <span className="text-sm font-medium text-gray-600">
            No versions available yet. Save your assignment as a version or
            publish it to create the first version.
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`fixed bottom-0 left-0 bg-white/95 backdrop-blur-md border-t border-gray-200/60 z-40 shadow-lg transition-all duration-300 ease-in-out ${
          isChatbotOpen ? "right-[25vw]" : "right-0"
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-50/30 via-white/50 to-indigo-50/30 pointer-events-none" />
        <div className="relative flex items-center justify-between px-6 py-3">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <button
                onClick={() => {
                  setVersionsOpen(!versionsOpen);
                  setDraftsOpen(false);
                }}
                className="group flex items-center space-x-3 px-4 py-2.5 rounded-xl hover:bg-white/60 transition-all duration-200 border border-gray-200/60 hover:border-indigo-300/60 hover:shadow-md backdrop-blur-sm bg-white/40"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 bg-indigo-100 rounded-lg group-hover:bg-indigo-200 transition-colors">
                    <GitBranch className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${getStatusColor()} animate-pulse`}
                    />

                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-gray-900">
                        v{workingVersion?.versionNumber || "0.0.0"}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${
                          getVersionStatus() === "modified"
                            ? "bg-amber-100 text-amber-700"
                            : getVersionStatus() === "checkout"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-green-100 text-green-700"
                        }`}
                      >
                        {getStatusText()}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronUp
                  className={`h-4 w-4 text-gray-400 transition-all duration-200 group-hover:text-indigo-500 ${
                    versionsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              <Dropdown
                isOpen={versionsOpen}
                onClose={() => setVersionsOpen(false)}
                width="450px"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <div className="p-1.5 bg-indigo-100 rounded-lg">
                        <GitBranch className="h-4 w-4 text-indigo-600" />
                      </div>
                      <h3 className="font-semibold text-gray-900">
                        Version History
                      </h3>
                    </div>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      {versions.length} versions
                    </span>
                  </div>

                  <div className="space-y-2 max-h-72 pb-14 overflow-y-auto custom-scrollbar">
                    {versions.map((version, index) => {
                      const isCurrentVersion =
                        version.id === currentVersion?.id;
                      const isCheckedOut = version.id === checkedOutVersion?.id;
                      const isWorking = version.id === workingVersion.id;

                      return (
                        <motion.button
                          key={version.id}
                          onClick={() =>
                            handleVersionSelect(
                              version.id,
                              version.versionNumber,
                            )
                          }
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          whileHover={{ scale: 1.01, y: -1 }}
                          whileTap={{ scale: 0.99 }}
                          className={`w-full p-4 rounded-xl border text-left transition-all duration-200 group relative overflow-hidden ${
                            isWorking
                              ? "border-indigo-300 bg-gradient-to-r from-indigo-50 to-purple-50 shadow-md"
                              : "border-gray-200/60 hover:border-indigo-200 hover:bg-gradient-to-r hover:from-gray-50/50 hover:to-blue-50/30 hover:shadow-sm"
                          }`}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />

                          <div className="relative flex items-start justify-between">
                            <div className="flex items-start space-x-3 min-w-0 flex-1">
                              <div className="flex flex-col items-center pt-1">
                                <div
                                  className={`w-3 h-3 rounded-full flex-shrink-0 transition-all ${
                                    isCurrentVersion
                                      ? "bg-green-500 shadow-lg shadow-green-500/30"
                                      : "bg-gray-300"
                                  }`}
                                />

                                {index < versions.length - 1 && (
                                  <div className="w-px h-12 bg-gradient-to-b from-gray-300 to-transparent mt-2" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center space-x-2 mb-2">
                                  <div className="flex items-center space-x-2">
                                    <Tag className="h-3.5 w-3.5 text-indigo-500" />
                                    <span className="font-semibold text-gray-900">
                                      v{version.versionNumber || "0.0.0"}
                                    </span>
                                  </div>
                                  <div className="flex space-x-1">
                                    {isCurrentVersion && (
                                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full flex items-center space-x-1">
                                        <CheckCircle className="h-3 w-3" />
                                        <span>Active</span>
                                      </span>
                                    )}
                                    {isCheckedOut && (
                                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full flex items-center space-x-1">
                                        <Eye className="h-3 w-3" />
                                        <span>Checked Out</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-sm text-gray-600 mb-2 line-clamp-2">
                                  {version.versionDescription || (
                                    <span className="italic text-gray-400">
                                      No description provided
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3 text-xs text-gray-500">
                                    <div className="flex items-center space-x-1">
                                      <Clock className="h-3 w-3" />
                                      <span>
                                        {formatVersionAge(version?.createdAt)}
                                      </span>
                                    </div>
                                    {version.createdBy && (
                                      <div className="flex items-center space-x-1">
                                        <User className="h-3 w-3" />
                                        <span className="truncate max-w-20">
                                          {version.createdBy}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  {getVersionQuestionCount(version) > 0 && (
                                    <div className="flex items-center space-x-1 text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                                      <Activity className="h-3 w-3" />
                                      <span>
                                        {getVersionQuestionCount(version)}{" "}
                                        questions
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavoriteVersion(version.id);
                              }}
                              className={`flex items-center space-x-1 p-1 rounded hover:bg-gray-100 transition-colors ${
                                isVersionFavorite(version.id)
                                  ? "text-yellow-500"
                                  : "text-gray-400 hover:text-yellow-500"
                              }`}
                              title={
                                isVersionFavorite(version.id)
                                  ? "Remove from favorites"
                                  : "Add to favorites"
                              }
                            >
                              <Star
                                className={`h-4 w-4 ${isVersionFavorite(version.id) ? "fill-current" : ""}`}
                              />
                            </button>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </Dropdown>
            </div>
          </div>

          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-4 text-gray-600">
              <div className="flex items-center space-x-2 px-2 py-1 bg-white/40 rounded-lg">
                <Clock className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-xs font-medium">
                  {formatVersionAge(workingVersion?.createdAt)}
                </span>
              </div>

              {workingVersion?.versionDescription && (
                <div className="flex items-center space-x-2 px-2 py-1 bg-white/40 rounded-lg max-w-80">
                  <Eye className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                  <span className="text-xs font-medium truncate">
                    {workingVersion?.versionDescription ||
                      workingVersion?.versionDescription}
                  </span>
                </div>
              )}

              <div className="flex items-center space-x-2 px-2 py-1 bg-white/40 rounded-lg">
                <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                <span className="text-xs font-medium">
                  {getVersionQuestionCount(workingVersion)} questions
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() =>
                router.push(`/author/${activeAssignmentId}/version-tree`)
              }
              className="group flex items-center space-x-2 px-4 py-2.5 text-sm font-medium bg-white/60 text-gray-700 rounded-xl hover:bg-white hover:text-indigo-600 transition-all duration-200 border border-gray-200/60 hover:border-indigo-300/60 hover:shadow-md backdrop-blur-sm"
            >
              <GitMerge className="h-4 w-4 group-hover:scale-110 group-hover:text-indigo-600 transition-all" />
              <span className="hidden sm:inline">Version History</span>
            </button>
          </div>
        </div>
      </div>

      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        onClose={handleModalClose}
        onSaveAndProceed={handleSaveAndProceed}
        onProceedWithoutSaving={handleProceedWithoutSaving}
        actionType={pendingAction?.type || "checkout"}
        targetName={pendingAction?.targetName}
      />

      <VersionSelectionModal
        isOpen={showVersionModal}
        onClose={() => setShowVersionModal(false)}
        onSave={handleVersionSave}
        currentVersions={versions.map((v) => ({
          versionNumber: v.versionNumber?.toString() || "0.0.0",
          id: v.id,
          isDraft: v.isDraft,
          isActive: v.isActive,
          published: v.published,
        }))}
        comparison={versionComparison}
        workingVersion={
          workingVersion
            ? {
                versionNumber:
                  workingVersion.versionNumber?.toString() || "0.0.0",
                id: workingVersion.id,
                isDraft: workingVersion.isDraft,
                isActive: workingVersion.isActive,
                published: workingVersion.published,
              }
            : undefined
        }
      />
    </>
  );
}
