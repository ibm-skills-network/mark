import { DraftSummary, VersionSummary } from "@/lib/author";
import { useAuthorStore } from "@/stores/author";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

export interface DraftData {
  name?: string;
  introduction?: string;
  instructions?: string;
  gradingCriteriaOverview?: string;
  questions?: any[];
  graded?: boolean;
  numAttempts?: number;
  passingGrade?: number;
  timeEstimateMinutes?: number;
  allotedTimeMinutes?: number;
  displayOrder?: any;
  questionDisplay?: any;
  showAssignmentScore?: boolean;
  showQuestionScore?: boolean;
  showSubmissionFeedback?: boolean;
  showQuestions?: boolean;
}

interface Draft {
  id: number;
  [key: string]: any;
}

export function useVersionControl() {
  // Version control state
  const versions = useAuthorStore((state) => state.versions);
  const currentVersion = useAuthorStore((state) => state.currentVersion);
  const checkedOutVersion = useAuthorStore((state) => state.checkedOutVersion);
  const selectedVersion = useAuthorStore((state) => state.selectedVersion);
  const versionComparison = useAuthorStore((state) => state.versionComparison);
  const isLoadingVersions = useAuthorStore((state) => state.isLoadingVersions);
  const versionsLoadFailed = useAuthorStore(
    (state) => state.versionsLoadFailed,
  );
  const hasAttemptedLoadVersions = useAuthorStore(
    (state) => state.hasAttemptedLoadVersions,
  );
  const hasUnsavedChanges = useAuthorStore((state) => state.hasUnsavedChanges);
  const lastAutoSave = useAuthorStore((state) => state.lastAutoSave);
  const activeAssignmentId = useAuthorStore(
    (state) => state.activeAssignmentId,
  );

  // Draft state from author store
  const drafts = useAuthorStore((state) => state.drafts || []);
  const isLoadingDrafts = useAuthorStore(
    (state) => state.isLoadingDrafts || false,
  );
  const draftsLoadFailed = useAuthorStore(
    (state) => state.draftsLoadFailed || false,
  );
  const hasAttemptedLoadDrafts = useAuthorStore(
    (state) => state.hasAttemptedLoadDrafts || false,
  );

  // Favorite versions state and actions
  const favoriteVersions = useAuthorStore(
    (state) => state.favoriteVersions || [],
  );
  const toggleFavoriteVersion = useAuthorStore(
    (state) => state.toggleFavoriteVersion,
  );
  const loadFavoriteVersions = useAuthorStore(
    (state) => state.loadFavoriteVersions,
  );

  // Draft actions
  const setDrafts = useAuthorStore((state) => state.setDrafts);
  const setIsLoadingDrafts = useAuthorStore(
    (state) => state.setIsLoadingDrafts,
  );
  const setDraftsLoadFailed = useAuthorStore(
    (state) => state.setDraftsLoadFailed,
  );
  const setHasAttemptedLoadDrafts = useAuthorStore(
    (state) => state.setHasAttemptedLoadDrafts,
  );

  // Version control actions
  const loadVersions = useAuthorStore((state) => state.loadVersions);
  const createVersion = useAuthorStore((state) => state.createVersion);
  const saveDraft = useAuthorStore((state) => state.saveDraft);
  const restoreVersion = useAuthorStore((state) => state.restoreVersion);
  const activateVersion = useAuthorStore((state) => state.activateVersion);
  const compareVersions = useAuthorStore((state) => state.compareVersions);
  const getVersionHistory = useAuthorStore((state) => state.getVersionHistory);
  const autoSave = useAuthorStore((state) => state.autoSave);
  const checkoutVersion = useAuthorStore((state) => state.checkoutVersion);
  const setSelectedVersion = useAuthorStore(
    (state) => state.setSelectedVersion,
  );
  const setVersionComparison = useAuthorStore(
    (state) => state.setVersionComparison,
  );
  const setHasUnsavedChanges = useAuthorStore(
    (state) => state.setHasUnsavedChanges,
  );
  const updateVersionDescription = useAuthorStore(
    (state) => state.updateVersionDescription,
  );

  // Enhanced actions with user feedback
  const createVersionWithToast = useCallback(
    async (
      versionDescription?: string,
      isDraft?: boolean,
      versionNumber?: string,
      updateExisting?: boolean,
    ) => {
      try {
        const newVersion = await createVersion(
          versionDescription,
          isDraft,
          versionNumber,
          updateExisting,
        );

        if (newVersion) {
          toast.success(
            updateExisting
              ? "Version updated successfully!"
              : isDraft
                ? "Draft version created successfully!"
                : "New version created successfully!",
          );

          // Force refresh versions to make sure UI updates
          await loadVersions();

          return newVersion;
        } else {
          toast.error("Failed to create version. Please try again.");
          return undefined;
        }
      } catch (error) {
        toast.error("An error occurred while creating the version.");
        throw error; // Re-throw to allow handling in component
      }
    },
    [createVersion, loadVersions],
  );

  const restoreVersionWithToast = useCallback(
    async (versionId: number, createAsNewVersion?: boolean) => {
      try {
        const actionText = createAsNewVersion
          ? "restore as new version"
          : "activate version";

        const restoredVersion = await restoreVersion(
          versionId,
          createAsNewVersion,
        );

        if (restoredVersion) {
          toast.success(`Successfully ${actionText}!`);
          return restoredVersion;
        } else {
          toast.error(`Failed to ${actionText}. Please try again.`);
          return undefined;
        }
      } catch (error) {
        toast.error("An error occurred while restoring the version.");
        return undefined;
      }
    },
    [restoreVersion],
  );

  const activateVersionWithToast = useCallback(
    async (versionId: number) => {
      try {
        const activatedVersion = await activateVersion(versionId);

        if (activatedVersion) {
          toast.success("Version activated successfully!");
          return activatedVersion;
        } else {
          toast.error("Failed to activate version. Please try again.");
          return undefined;
        }
      } catch (error) {
        toast.error("An error occurred while activating the version.");
        return undefined;
      }
    },
    [activateVersion],
  );

  const compareVersionsWithToast = useCallback(
    async (fromVersionId: number, toVersionId: number) => {
      try {
        await compareVersions(fromVersionId, toVersionId);
        toast.success("Version comparison loaded successfully!");
      } catch (error) {
        toast.error("An error occurred while comparing versions.");
      }
    },
    [compareVersions],
  );

  const checkoutVersionWithToast = useCallback(
    async (versionId: number, versionNumber?: string | number) => {
      try {
        const success = await checkoutVersion(versionId);

        if (success) {
          toast.success(
            `${versionNumber || versionId} data has loaded successfully`,
          );
          return true;
        } else {
          toast.error("Failed to checkout version. Please try again.");
          return false;
        }
      } catch (error) {
        toast.error("An error occurred while checking out the version.");
        return false;
      }
    },
    [checkoutVersion],
  );

  const loadDraft = useCallback(
    async (draftId: number) => {
      if (!activeAssignmentId) return false;

      try {
        const { getDraft } = await import("@/lib/author");
        const draftData = await getDraft(activeAssignmentId, draftId);

        if (draftData) {
          const typedDraftData = draftData as unknown as DraftData;
          // Load draft data into the author store - use direct setters to ensure overwrite
          const store = useAuthorStore.getState();
          store.setName(typedDraftData.name || "");
          store.setIntroduction(typedDraftData.introduction || "");
          store.setInstructions(typedDraftData.instructions || "");
          store.setGradingCriteriaOverview(
            typedDraftData.gradingCriteriaOverview || "",
          );
          store.setQuestions((typedDraftData.questions || []) as any);

          // Also load settings into assignment config stores
          const { useAssignmentConfig } = await import(
            "@/stores/assignmentConfig"
          );
          const { useAssignmentFeedbackConfig } = await import(
            "@/stores/assignmentFeedbackConfig"
          );

          // Update assignment config store with draft settings
          const assignmentConfigStore = useAssignmentConfig.getState();
          if (assignmentConfigStore.setAssignmentConfigStore) {
            (assignmentConfigStore.setAssignmentConfigStore as any)({
              graded:
                typedDraftData.graded !== undefined
                  ? typedDraftData.graded
                  : assignmentConfigStore.graded,
              numAttempts:
                typedDraftData.numAttempts !== undefined
                  ? typedDraftData.numAttempts
                  : assignmentConfigStore.numAttempts,
              passingGrade:
                typedDraftData.passingGrade !== undefined
                  ? typedDraftData.passingGrade
                  : assignmentConfigStore.passingGrade,
              timeEstimateMinutes:
                typedDraftData.timeEstimateMinutes !== undefined
                  ? typedDraftData.timeEstimateMinutes
                  : assignmentConfigStore.timeEstimateMinutes,
              allotedTimeMinutes:
                typedDraftData.allotedTimeMinutes !== undefined
                  ? typedDraftData.allotedTimeMinutes
                  : assignmentConfigStore.allotedTimeMinutes,
              displayOrder:
                typedDraftData.displayOrder !== undefined
                  ? typedDraftData.displayOrder
                  : assignmentConfigStore.displayOrder,
              questionDisplay:
                typedDraftData.questionDisplay !== undefined
                  ? typedDraftData.questionDisplay
                  : assignmentConfigStore.questionDisplay,
            });
          }

          // Update feedback config store with draft settings
          const feedbackConfigStore = useAssignmentFeedbackConfig.getState();
          if (feedbackConfigStore.setAssignmentFeedbackConfigStore) {
            (feedbackConfigStore.setAssignmentFeedbackConfigStore as any)({
              showAssignmentScore:
                typedDraftData.showAssignmentScore !== undefined
                  ? typedDraftData.showAssignmentScore
                  : feedbackConfigStore.showAssignmentScore,
              showQuestionScore:
                typedDraftData.showQuestionScore !== undefined
                  ? typedDraftData.showQuestionScore
                  : feedbackConfigStore.showQuestionScore,
              showSubmissionFeedback:
                typedDraftData.showSubmissionFeedback !== undefined
                  ? typedDraftData.showSubmissionFeedback
                  : feedbackConfigStore.showSubmissionFeedback,
              showQuestions:
                typedDraftData.showQuestions !== undefined
                  ? typedDraftData.showQuestions
                  : feedbackConfigStore.showQuestions,
            });
          }

          toast.success("Draft loaded successfully!");
          return true;
        } else {
          toast.error("Failed to load draft");
          return false;
        }
      } catch (error) {
        toast.error("An error occurred while loading the draft");
        return false;
      }
    },
    [activeAssignmentId],
  );

  const deleteDraft = useCallback(
    async (draftId: number) => {
      if (!activeAssignmentId) return false;

      try {
        const { deleteDraft: deleteDraftAPI } = await import("@/lib/author");
        const success = await deleteDraftAPI(activeAssignmentId, draftId);

        if (success) {
          const currentDrafts = useAuthorStore.getState().drafts || [];
          const filteredDrafts = (currentDrafts as DraftSummary[]).filter(
            (draft) => draft.id !== draftId,
          );
          setDrafts(filteredDrafts);
          toast.success("Draft deleted successfully!");
          return true;
        } else {
          toast.error("Failed to delete draft");
          return false;
        }
      } catch (error) {
        toast.error("An error occurred while deleting the draft");
        return false;
      }
    },
    [activeAssignmentId, setDrafts],
  );

  // Auto-save functionality (disabled per user request)
  const enableAutoSave = useCallback((_intervalMinutes = 5) => {
    return () => {
      // Auto-save is disabled
    };
  }, []);

  const updateExistingVersionWithToast = async (
    versionId: number,
    versionNumber: string,
    versionDescription?: string,
    isDraft?: boolean,
  ): Promise<VersionSummary | undefined> => {
    try {
      toast.loading(`Updating version ${versionNumber}...`);

      if (!activeAssignmentId) {
        throw new Error("No assignment selected");
      }

      // Use createVersion with updateExisting: true to update the existing version's content
      // This preserves the version number while updating content with current assignment data
      const updatedVersion = await createVersion(
        versionDescription,
        isDraft || false,
        versionNumber,
        true, // updateExisting = true is key for updating instead of creating
        versionId, // Pass the specific version ID to update
      );

      if (updatedVersion) {
        toast.dismiss();
        toast.success(`Version ${versionNumber} updated successfully`);
        await loadVersions(); // Refresh the version list
      } else {
        throw new Error("Failed to update version");
      }

      return updatedVersion;
    } catch (error) {
      toast.dismiss();
      toast.error(`Failed to update version ${versionNumber}`);
      throw error;
    }
  };

  // Auto-load versions when assignment changes - moved to store level to prevent multiple calls
  useEffect(() => {
    if (activeAssignmentId && !hasAttemptedLoadVersions) {
      // Use store's loadVersions which has built-in protection against concurrent calls
      loadVersions().catch(() => {
        // Handle error silently
      });
    }
  }, [activeAssignmentId, hasAttemptedLoadVersions, loadVersions]);

  // Reset draft state when assignment changes
  useEffect(() => {
    // Clear all draft state
    setDrafts([]);
    setIsLoadingDrafts(false);
    setDraftsLoadFailed(false);
    setHasAttemptedLoadDrafts(false);
  }, [activeAssignmentId]); // Only depend on assignment ID

  // Auto-load favorite versions when assignment changes
  useEffect(() => {
    if (activeAssignmentId) {
      loadFavoriteVersions().catch(() => {
        // Handle error silently
      });
    }
  }, [activeAssignmentId, loadFavoriteVersions]);

  // Utility functions
  const getDraftVersions = useCallback(() => {
    return versions.filter((version) => version.isDraft);
  }, [versions]);

  const getPublishedVersions = useCallback(() => {
    return versions.filter((version) => !version.isDraft);
  }, [versions]);

  const getLatestVersion = useCallback(() => {
    return versions.reduce((latest, version) => {
      return version.versionNumber > (latest?.versionNumber || 0)
        ? version
        : latest;
    }, versions[0]);
  }, [versions]);

  const canRestoreVersion = useCallback(
    (versionId: number) => {
      const version = versions.find((v) => v.id === versionId);
      return version && !version.isActive;
    },
    [versions],
  );

  const formatVersionAge = useCallback((createdAt: string) => {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    }
  }, []);

  // Favorite version utility functions
  const isVersionFavorite = useCallback(
    (versionId: number) => {
      return favoriteVersions.includes(versionId);
    },
    [favoriteVersions],
  );

  const getFavoriteVersions = useCallback(() => {
    return versions.filter((version) => favoriteVersions.includes(version.id));
  }, [versions, favoriteVersions]);

  // Simplified force refresh function
  const forceRefreshDrafts = useCallback(async () => {
    if (!activeAssignmentId) {
      return;
    }

    // Reset states and reload
    setHasAttemptedLoadDrafts(false);
    setDraftsLoadFailed(false);
    setDrafts([]);
  }, [activeAssignmentId]);

  // Simplified debug functions
  const debugForceStateRefresh = useCallback(() => {
    const currentState = useAuthorStore.getState();
    // Debug information available but not logged
    return {
      draftsCount: currentState.drafts?.length || 0,
      isLoading: currentState.isLoadingDrafts,
      loadFailed: currentState.draftsLoadFailed,
      hasAttempted: currentState.hasAttemptedLoadDrafts,
      assignmentId: activeAssignmentId,
    };
  }, [activeAssignmentId]);

  // Force clear loading state function
  const forceClearLoadingState = useCallback(() => {
    setIsLoadingDrafts(false);
    setDraftsLoadFailed(false);
  }, []);

  return {
    // State
    versions,
    currentVersion,
    checkedOutVersion,
    selectedVersion,
    versionComparison,
    isLoadingVersions,
    versionsLoadFailed,
    hasAttemptedLoadVersions,
    hasUnsavedChanges,
    lastAutoSave,

    // Draft State
    drafts,
    isLoadingDrafts,
    draftsLoadFailed,
    hasAttemptedLoadDrafts,

    // Favorite Versions State
    favoriteVersions,

    // Actions
    loadVersions,
    createVersion: createVersionWithToast,
    restoreVersion: restoreVersionWithToast,
    activateVersion: activateVersionWithToast,
    compareVersions: compareVersionsWithToast,
    checkoutVersion: checkoutVersionWithToast,
    getVersionHistory,
    autoSave,
    enableAutoSave,
    updateExistingVersion: updateExistingVersionWithToast,

    // Draft Actions
    loadDraft,
    deleteDraft,
    forceRefreshDrafts,

    // Favorite Version Actions
    toggleFavoriteVersion,
    loadFavoriteVersions,
    updateVersionDescription,

    // State setters
    setSelectedVersion,
    setVersionComparison,
    setHasUnsavedChanges,

    // Utility functions
    getDraftVersions,
    getPublishedVersions,
    getLatestVersion,
    canRestoreVersion,
    formatVersionAge,
    isVersionFavorite,
    getFavoriteVersions,

    // Debug functions
    debugForceStateRefresh,
    forceClearLoadingState,
  };
}
