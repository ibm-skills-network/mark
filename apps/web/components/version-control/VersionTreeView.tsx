"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { useRouter } from "next/navigation";
import { useChatbot } from "@/hooks/useChatbot";
import { UnpublishedActivationModal } from "./UnpublishedActivationModal";
import {
  GitBranch,
  Clock,
  User,
  ArrowLeft,
  GitCommit,
  GitMerge,
  Tag,
  FileText,
  Eye,
  Download,
  MoreVertical,
  CheckCircle,
  AlertCircle,
  BarChart3,
  TrendingUp,
  Calendar,
  Hash,
  Edit3,
  Save,
  Star,
  Activity,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  SortAsc,
  SortDesc,
} from "lucide-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import semver from "semver";
import { motion, AnimatePresence } from "framer-motion";
import {
  parseSemanticVersion,
  formatSemanticVersion,
} from "@/lib/semantic-versioning";
import { toast } from "sonner";
import { UnsavedChangesModal } from "./UnsavedChangesModal";

// Table row type for versions
interface VersionTableRow {
  id: number;
  versionNumber: string;
  versionDescription: string;
  isActive: boolean;
  isDraft: boolean;
  published: boolean;
  questionCount: number;
  totalPoints: number;
  createdBy: string;
  createdAt: string;
  age: string;
  isCheckedOut: boolean;
  isFavorite: boolean;
  actions: any; // for action buttons
}

interface Props {
  assignmentId: string;
}

export function VersionTreeView({ assignmentId }: Props) {
  const router = useRouter();
  const { isOpen: isChatbotOpen } = useChatbot();

  // Modal and action states
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [selectedVersionDetails, setSelectedVersionDetails] =
    useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: "checkout" | "loadDraft";
    version: any;
    isDraft: boolean;
    targetName?: string;
  } | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [showUnpublishedModal, setShowUnpublishedModal] = useState(false);
  const [pendingActivationVersion, setPendingActivationVersion] =
    useState<any>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [versionToEdit, setVersionToEdit] = useState<any>(null);
  const [newVersionNumber, setNewVersionNumber] = useState("");
  const [replacementVersionId, setReplacementVersionId] = useState<
    number | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);

  // Table states
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10, // Show 10 versions per page
  });

  const versionControlHook = useVersionControl();
  const {
    versions,
    currentVersion,
    formatVersionAge,
    hasUnsavedChanges,
    drafts,
    loadDraft,
    activateVersion,
    toggleFavoriteVersion,
    isVersionFavorite,
    getFavoriteVersions,
    updateVersionDescription,
  } = versionControlHook;

  // Handle potentially missing properties
  const checkedOutVersion =
    (versionControlHook as any).checkedOutVersion || null;
  const checkoutVersion =
    (versionControlHook as any).checkoutVersion ||
    (() => Promise.resolve(false));

  // Helper functions for version data
  const getVersionQuestionCount = (version: any) => {
    return version?.questionVersions?.length || version?.questionCount || 0;
  };

  const getVersionTotalPoints = (version: any) => {
    if (!version?.questionVersions) return 0;
    return version.questionVersions.reduce(
      (sum: number, q: any) => sum + (q.totalPoints || 0),
      0,
    );
  };
  const handleNodeClick = async (
    version: any,
    isDraft = false,
    overrideUnsaved = false,
  ) => {
    // Check for unsaved changes first
    if (hasUnsavedChanges && !overrideUnsaved) {
      const targetName = isDraft
        ? version.name || "Draft"
        : `v${version.versionNumber}`;

      setPendingAction({
        type: isDraft ? "loadDraft" : "checkout",
        version,
        isDraft,
        targetName,
      });
      setShowUnsavedModal(true);
      return;
    }

    // Proceed with original functionality
    await proceedWithNodeClick(version, isDraft);
  };

  // Handle viewing details with proper data fetching
  const handleViewDetails = useCallback(
    async (version: any, isDraft = false) => {
      await handleNodeClick(version, isDraft, true);
      setShowDetails(true);
    },
    [],
  );

  const handleCheckoutVersion = useCallback(
    async (version: any, isDraft: boolean) => {
      if (isDraft) {
        await loadDraft(version.id);
      } else {
        await checkoutVersion(version.id, version.versionNumber);
      }
      // Navigate to questions page after checkout
      router.push(`/author/${assignmentId}/questions`);
    },
    [loadDraft, checkoutVersion, router, assignmentId],
  );

  const handleActivateVersion = useCallback(
    async (version: any) => {
      if (version.isActive) return; // Already active

      // Check if this is an RC version
      const versionString = version.versionNumber?.toString() || "";
      const isRCVersion = version.versionNumber?.toString().includes("-rc");

      // Check if version is published (not a draft and explicitly published)
      if (version.isDraft || (!version.published && !isRCVersion)) {
        setPendingActivationVersion(version);
        setShowUnpublishedModal(true);
        return;
      }

      try {
        // For RC versions and regular published versions, activate directly
        // The backend will handle RC -> final version conversion
        await activateVersion(version.id);

        // Show success message
        if (isRCVersion) {
          toast.success(
            `RC ${versionString} published and activated successfully!`,
          );
        } else {
          toast.success(`Version ${versionString} activated successfully!`);
        }

        // Refresh the version list to ensure UI is up to date
        await versionControlHook.loadVersions();
      } catch (error) {
        console.error("Failed to activate version:", error);
        toast.error("Failed to activate version");
      }
    },
    [activateVersion, versionControlHook.loadVersions],
  );

  // Prepare table data
  const tableData = useMemo((): VersionTableRow[] => {
    return versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber?.toString() || "0.0.0",
      versionDescription: version.versionDescription || "",
      isActive: version.isActive || false,
      isDraft: version.isDraft || false,
      published: version.published || false,
      questionCount: getVersionQuestionCount(version),
      totalPoints: getVersionTotalPoints(version),
      createdBy: version.createdBy || "",
      createdAt: new Date(version.createdAt).toLocaleString(),
      age: formatVersionAge(version.createdAt),
      isCheckedOut: checkedOutVersion?.id === version.id,
      isFavorite: isVersionFavorite(version.id),
      actions: version, // pass the full version object for action buttons
    }));
  }, [versions, checkedOutVersion, isVersionFavorite, formatVersionAge]);

  // Create column helper for type safety
  const columnHelper = createColumnHelper<VersionTableRow>();

  // Define table columns
  const columns = useMemo<ColumnDef<VersionTableRow, any>[]>(
    () => [
      columnHelper.accessor("versionNumber", {
        header: "Version",
        cell: ({ row }) => (
          <div className="flex items-center space-x-2">
            <div
              className={`w-3 h-3 rounded-full ${
                row.original.isActive
                  ? "bg-green-500"
                  : row.original.isCheckedOut
                    ? "bg-purple-500"
                    : "bg-gray-400"
              }`}
            />
            <Tag className="h-4 w-4 text-indigo-600" />
            <span className="font-semibold text-gray-900">
              v{row.original.versionNumber}
            </span>
          </div>
        ),
        enableSorting: true,
        sortingFn: (rowA, rowB) =>
          semver.compare(
            rowA.original.versionNumber,
            rowB.original.versionNumber,
          ),
      }),

      columnHelper.accessor("versionDescription", {
        header: "Description",
        cell: ({ getValue }) => (
          <div className="max-w-xs">
            <p className="text-sm text-gray-900 truncate">
              {getValue() || (
                <span className="italic text-gray-400">No description</span>
              )}
            </p>
          </div>
        ),
        enableSorting: true,
      }),

      columnHelper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.isActive && (
              <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full flex items-center space-x-1">
                <CheckCircle className="h-3 w-3" />
                <span>Active</span>
              </span>
            )}
            {row.original.isCheckedOut && (
              <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center space-x-1">
                <Eye className="h-3 w-3" />
                <span>Checked Out</span>
              </span>
            )}
            {row.original.isDraft ? (
              <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded-full">
                Draft
              </span>
            ) : row.original.published ? (
              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                Published
              </span>
            ) : (
              <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">
                Unpublished
              </span>
            )}
            {row.original.isFavorite && (
              <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full flex items-center space-x-1">
                <Star className="h-3 w-3 fill-current" />
                <span>Favorite</span>
              </span>
            )}
          </div>
        ),
      }),

      columnHelper.accessor("questionCount", {
        header: "Questions",
        cell: ({ getValue }) => (
          <div className="flex items-center space-x-1">
            <Activity className="h-4 w-4 text-indigo-600" />
            <span className="font-medium text-gray-900">{getValue()}</span>
          </div>
        ),
        enableSorting: true,
      }),

      columnHelper.accessor("createdBy", {
        header: "Created By",
        cell: ({ getValue }) => (
          <div className="flex items-center space-x-1">
            <User className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-700 truncate max-w-25">
              {getValue() || "Unknown"}
            </span>
          </div>
        ),
        enableSorting: true,
      }),

      columnHelper.accessor("createdAt", {
        header: "Created",
        cell: ({ getValue, row }) => (
          <div className="flex items-center space-x-1">
            <Clock className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-700">{getValue()}</span>
          </div>
        ),
        enableSorting: true,
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.createdAt).getTime() -
          new Date(rowB.original.createdAt).getTime(),
      }),

      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleViewDetails(row.original.actions, false)}
              className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
            >
              <Eye className="h-3 w-3" />
              <span>Details</span>
            </button>
            <button
              onClick={() => handleCheckoutVersion(row.original.actions, false)}
              className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
            >
              <CheckCircle className="h-3 w-3" />
              <span>Edit</span>
            </button>
            {!row.original.isActive && (
              <button
                onClick={() => handleActivateVersion(row.original.actions)}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
              >
                <span>Activate</span>
              </button>
            )}
            <button
              onClick={() => toggleFavoriteVersion(row.original.id)}
              className={`p-1.5 rounded-md transition-colors ${
                row.original.isFavorite
                  ? "text-yellow-500 hover:text-yellow-600"
                  : "text-gray-400 hover:text-yellow-500"
              }`}
              title={
                row.original.isFavorite
                  ? "Remove from favorites"
                  : "Add to favorites"
              }
            >
              <Star
                className={`h-4 w-4 ${row.original.isFavorite ? "fill-current" : ""}`}
              />
            </button>
          </div>
        ),
      }),
    ],
    [
      handleViewDetails,
      handleCheckoutVersion,
      handleActivateVersion,
      toggleFavoriteVersion,
    ],
  );

  // Create table instance
  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination,
    },
    globalFilterFn: "includesString",
  });

  // Calculate stats
  const versionStats = useMemo(() => {
    const totalVersions = versions.length;
    const totalDrafts = drafts?.length || 0;
    const publishedVersions = versions.filter(
      (v) => !v.isDraft && v.published === true,
    ).length;
    const unpublishedVersions = versions.filter(
      (v) => v.isDraft || v.published !== true,
    ).length;
    const latestVersion = versions.reduce(
      (latest, version) =>
        version.versionNumber > (latest?.versionNumber || 0) ? version : latest,
      versions[0],
    );

    return {
      totalVersions,
      totalDrafts,
      publishedVersions,
      unpublishedVersions,
      latestVersion,
      totalQuestions: getVersionQuestionCount(
        selectedVersionDetails || latestVersion,
      ),
    };
  }, [versions, drafts, selectedVersionDetails]);

  const proceedWithNodeClick = async (version: any, isDraft = false) => {
    setSelectedVersion(version);
    setSelectedVersionDetails(null); // Clear previous details

    // If it's a draft, we don't need to fetch additional details
    if (isDraft) {
      setSelectedVersionDetails(version);
      return;
    }

    try {
      setIsLoadingDetails(true);
      const { getAssignmentVersion } = await import("@/lib/author");
      const detailedVersion = await getAssignmentVersion(
        Number(assignmentId),
        version.id,
      );

      if (detailedVersion) {
        setSelectedVersionDetails(detailedVersion);
      } else {
        console.warn(
          "⚠️ No detailed version data returned, using basic version info",
        );
        setSelectedVersionDetails(version);
      }
    } catch (error) {
      console.error("❌ Error fetching version details:", error);
      setSelectedVersionDetails(version); // Fallback to basic version info
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Modal handlers for unsaved changes
  const handleSaveAndProceed = async () => {
    try {
      if (pendingAction) {
        await proceedWithNodeClick(
          pendingAction.version,
          pendingAction.isDraft,
        );
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
      await proceedWithNodeClick(pendingAction.version, pendingAction.isDraft);
    }

    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  const handleModalClose = () => {
    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  const handlePublishAndActivate = async () => {
    if (!pendingActivationVersion) return;

    setIsPublishing(true);
    const versionToActivate = pendingActivationVersion;
    const versionString = versionToActivate.versionNumber?.toString() || "";

    try {
      // Close the modal first
      setShowUnpublishedModal(false);
      setPendingActivationVersion(null);

      // For drafts, we need to publish first then activate
      if (versionToActivate.isDraft) {
        // First checkout the version to load its data
        await checkoutVersion(versionToActivate.id);

        // Trigger the header publish functionality for drafts
        const headerPublishEvent = new CustomEvent("triggerHeaderPublish", {
          detail: {
            description: `Published draft ${versionString}`,
            publishImmediately: true,
            versionNumber: versionString,
            updateExisting: false,
            afterPublish: async () => {
              try {
                await activateVersion(versionToActivate.id);
                await versionControlHook.loadVersions();
                toast.success(
                  `Draft ${versionString} published and activated successfully!`,
                );
              } catch (activationError) {
                console.error(
                  "Failed to activate after publishing:",
                  activationError,
                );
                toast.error("Version published but failed to activate");
              }
            },
          },
        });
        window.dispatchEvent(headerPublishEvent);
      } else {
        // For unpublished versions, just activate directly (backend handles publishing)
        await activateVersion(versionToActivate.id);
        await versionControlHook.loadVersions();
        toast.success(
          `Version ${versionString} published and activated successfully!`,
        );
      }
    } catch (error) {
      console.error("Failed to publish and activate version:", error);
      toast.error("Failed to publish and activate version");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCancelActivation = () => {
    setShowUnpublishedModal(false);
    setPendingActivationVersion(null);
  };

  // Delete version handlers
  const handleDeleteVersion = (version: any) => {
    setVersionToDelete(version);
    setShowDeleteModal(true);
  };

  const confirmDeleteVersion = async () => {
    if (!versionToDelete) return;

    setIsDeleting(true);
    try {
      const { deleteVersion } = await import("@/lib/author");

      // If deleting active version, activate replacement first
      if (versionToDelete.isActive && replacementVersionId) {
        await activateVersion(replacementVersionId);
      }

      await deleteVersion(Number(assignmentId), versionToDelete.id);
      await versionControlHook.loadVersions();

      toast.success(
        `Version ${versionToDelete.versionNumber} deleted successfully`,
      );
      setShowDeleteModal(false);
      setVersionToDelete(null);
      setReplacementVersionId(null);
    } catch (error) {
      console.error("Failed to delete version:", error);
      toast.error("Failed to delete version");
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setVersionToDelete(null);
    setReplacementVersionId(null);
  };

  // Edit version number handlers
  const handleEditVersion = (version: any) => {
    setVersionToEdit(version);
    setNewVersionNumber(version.versionNumber?.toString() || "");
    setShowEditModal(true);
  };

  const confirmEditVersion = async () => {
    if (!versionToEdit || !newVersionNumber.trim()) return;

    // Check for version conflicts
    const existingVersion = versions.find(
      (v) =>
        v.versionNumber?.toString() === newVersionNumber &&
        v.id !== versionToEdit.id,
    );

    if (existingVersion) {
      toast.error(`Version ${newVersionNumber} already exists`);
      return;
    }

    try {
      // Import the update function (we'll need to add this to the author lib)
      const { updateVersionNumber } = await import("@/lib/author");
      await updateVersionNumber(
        Number(assignmentId),
        versionToEdit.id,
        newVersionNumber,
      );
      await versionControlHook.loadVersions();

      toast.success(`Version number updated to ${newVersionNumber}`);
      setShowEditModal(false);
      setVersionToEdit(null);
      setNewVersionNumber("");
    } catch (error) {
      console.error("Failed to update version number:", error);
      toast.error("Failed to update version number");
    }
  };

  const cancelEdit = () => {
    setShowEditModal(false);
    setVersionToEdit(null);
    setNewVersionNumber("");
  };

  return (
    <div
      className={`fixed top-16 left-0 bottom-0 bg-gradient-to-br from-slate-50 via-purple-50 to-indigo-100 flex flex-col z-30 transition-all duration-300 ease-in-out ${
        isChatbotOpen ? "right-[25vw]" : "right-0"
      }`}
    >
      {/* Header - Fixed */}
      <div className="bg-white/95 backdrop-blur-sm border-b border-gray-200 px-6 py-4 shadow-sm 2xl:mt-5 xl:mt-16 lg:mt-16 md:mt-32 sm:mt-32 mt-32">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 gap-2">
            <button
              onClick={() => router.push(`/author/${assignmentId}`)}
              className="flex items-center space-x-2 text-gray-600 hover:text-indigo-600 transition-colors duration-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="font-medium">Back to Editor</span>
            </button>

            <div className="h-6 w-px bg-gray-300" />

            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <GitMerge className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Version History
                </h1>
                <p className="text-sm text-gray-500">
                  Track and manage assignment versions
                </p>
              </div>
            </div>
            <div className="h-6 w-px bg-gray-300" />

            {/* Legend */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-2 px-2 py-1 bg-green-50 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-green-700 font-medium">Published</span>
                </div>
                <div className="flex items-center space-x-2 px-2 py-1 bg-purple-50 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                  <span className="text-purple-700 font-medium">
                    Checked Out
                  </span>
                </div>
                <div className="flex items-center space-x-2 px-2 py-1 bg-gray-50 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                  <span className="text-gray-700 font-medium">Version</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-100">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Hash className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Versions</p>
                <p className="text-lg font-semibold text-gray-900">
                  {versionStats.totalVersions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Published</p>
                <p className="text-lg font-semibold text-gray-900">
                  {versionStats.publishedVersions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Unpublished</p>
                <p className="text-lg font-semibold text-gray-900">
                  {versionStats.unpublishedVersions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Edit3 className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">My Private Drafts</p>
                <p className="text-lg font-semibold text-gray-900">
                  {versionStats.totalDrafts}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <FileText className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Latest Version</p>
                <p className="text-lg font-semibold text-gray-900">
                  v{versionStats.latestVersion?.versionNumber || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Activity className="h-4 w-4 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Questions</p>
                <p className="text-lg font-semibold text-gray-900">
                  {versionStats.totalQuestions}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 p-6 mb-20">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                  <GitBranch className="h-5 w-5 text-indigo-600" />
                  <span>Version History</span>
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Searchable and filterable table of all assignment versions
                </p>
              </div>
              {getFavoriteVersions().length > 0 && (
                <button
                  onClick={() => setShowFavoritesModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
                >
                  <Star className="h-4 w-4 fill-current" />
                  <span>
                    Show Starred Versions ({getFavoriteVersions().length})
                  </span>
                </button>
              )}
            </div>

            {/* Search and Filters */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search versions..."
                  value={globalFilter ?? ""}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
                {globalFilter && (
                  <button
                    onClick={() => setGlobalFilter("")}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <span>
                  Showing {table.getFilteredRowModel().rows.length} of{" "}
                  {versions.length} versions
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <th
                            key={header.id}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={
                              header.column.getCanSort()
                                ? header.column.getToggleSortingHandler()
                                : undefined
                            }
                          >
                            <div className="flex items-center space-x-1">
                              <span>
                                {header.isPlaceholder
                                  ? null
                                  : flexRender(
                                      header.column.columnDef.header,
                                      header.getContext(),
                                    )}
                              </span>
                              {header.column.getCanSort() && (
                                <span className="flex flex-col">
                                  {{
                                    asc: (
                                      <SortAsc className="h-3 w-3 text-gray-400" />
                                    ),
                                    desc: (
                                      <SortDesc className="h-3 w-3 text-gray-400" />
                                    ),
                                  }[header.column.getIsSorted() as string] ?? (
                                    <div className="flex flex-col">
                                      <ChevronUp className="h-2 w-2 text-gray-300" />
                                      <ChevronDown className="h-2 w-2 text-gray-300 -mt-1" />
                                    </div>
                                  )}
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {table.getRowModel().rows.map((row, index) => (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="px-6 py-4 whitespace-nowrap"
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Empty State */}
            {table.getFilteredRowModel().rows.length === 0 && (
              <div className="text-center py-12">
                <div className="p-4 bg-gray-50 rounded-2xl mx-auto w-fit mb-4">
                  <GitBranch className="h-8 w-8 mx-auto text-gray-300" />
                </div>
                {globalFilter ? (
                  <>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No versions match your search
                    </p>
                    <p className="text-xs text-gray-400">
                      Try adjusting your search terms
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No versions yet
                    </p>
                    <p className="text-xs text-gray-400">
                      Save your first version to see it here
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Pagination */}
            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-700">
                    Page {table.getState().pagination.pageIndex + 1} of{" "}
                    {table.getPageCount()}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Details Modal */}
      <AnimatePresence>
        {showDetails && selectedVersion && (
          <>
            {isLoadingDetails && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-6 flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                  <span className="text-gray-700 font-medium">
                    Loading version details...
                  </span>
                </div>
              </div>
            )}

            {!isLoadingDetails && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                onClick={() => setShowDetails(false)}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Modal Header */}
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-semibold text-gray-900">
                        {(selectedVersionDetails || selectedVersion)
                          .versionNumber
                          ? `Version ${(selectedVersionDetails || selectedVersion).versionNumber} Details`
                          : `Draft: ${(selectedVersionDetails || selectedVersion).name}`}
                      </h2>
                      <button
                        onClick={() => setShowDetails(false)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Modal Content */}
                  <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
                    <div className="space-y-6">
                      {/* Basic Info */}
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Assignment Name
                          </label>
                          <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">
                            {(selectedVersionDetails || selectedVersion).name ||
                              "Untitled Assignment"}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Created
                          </label>
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <p className="text-gray-900 font-medium">
                              {formatVersionAge(
                                (selectedVersionDetails || selectedVersion)
                                  .createdAt,
                              )}
                            </p>
                            {(selectedVersionDetails || selectedVersion)
                              .createdBy && (
                              <p className="text-sm text-gray-600 mt-1">
                                by{" "}
                                {
                                  (selectedVersionDetails || selectedVersion)
                                    .createdBy
                                }
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Version Info */}
                      <div className="grid grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Version Number
                          </label>
                          <div className="bg-gray-50 p-3 rounded-lg flex items-center space-x-2">
                            <Tag className="h-4 w-4 text-indigo-600" />
                            <span className="text-gray-900 font-semibold">
                              v
                              {
                                (selectedVersionDetails || selectedVersion)
                                  .versionNumber
                              }
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Status
                          </label>
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="flex flex-wrap gap-1">
                              {(selectedVersionDetails || selectedVersion)
                                .isActive && (
                                <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full flex items-center space-x-1">
                                  <CheckCircle className="h-3 w-3" />
                                  <span>Active</span>
                                </span>
                              )}
                              {(selectedVersionDetails || selectedVersion)
                                .isDraft && (
                                <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded-full flex items-center space-x-1">
                                  <FileText className="h-3 w-3" />
                                  <span>Draft</span>
                                </span>
                              )}
                              {(selectedVersionDetails || selectedVersion)
                                .published && (
                                <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">
                                  Published
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Questions
                          </label>
                          <div className="bg-gray-50 p-3 rounded-lg flex items-center space-x-2">
                            <Activity className="h-4 w-4 text-purple-600" />
                            <span className="text-gray-900 font-semibold">
                              {getVersionQuestionCount(
                                selectedVersionDetails || selectedVersion,
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      {selectedVersion.versionDescription && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Version Description
                          </label>
                          <div className="bg-purple-50  p-3 rounded-lg">
                            <p className="text-gray-900">
                              {
                                (selectedVersionDetails || selectedVersion)
                                  .versionDescription
                              }
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Assignment Content */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
                          Assignment Content
                        </h3>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-purple-600" />
                            <span>Introduction</span>
                          </label>
                          <div className="bg-gray-50 border rounded-lg p-4 max-h-40 overflow-y-auto">
                            <div
                              className="text-gray-900 prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{
                                __html: (
                                  selectedVersionDetails || selectedVersion
                                ).introduction,
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-green-600" />
                            <span>Instructions</span>
                          </label>
                          <div className="bg-gray-50 border rounded-lg p-4 max-h-40 overflow-y-auto">
                            <div
                              className="text-gray-900 prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{
                                __html: (
                                  selectedVersionDetails || selectedVersion
                                ).instructions,
                              }}
                            />
                          </div>
                        </div>

                        {(selectedVersionDetails || selectedVersion)
                          .gradingCriteriaOverview && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center space-x-2">
                              <BarChart3 className="h-4 w-4 text-purple-600" />
                              <span>Grading Criteria</span>
                            </label>
                            <div className="bg-gray-50 border rounded-lg p-4 max-h-40 overflow-y-auto">
                              <div
                                className="text-gray-900 prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{
                                  __html: (
                                    selectedVersionDetails || selectedVersion
                                  ).gradingCriteriaOverview,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Questions Summary */}
                      {(selectedVersionDetails || selectedVersion)
                        ?.questionVersions &&
                        (selectedVersionDetails || selectedVersion)
                          .questionVersions.length > 0 && (
                          <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center space-x-2">
                              <Activity className="h-5 w-5 text-indigo-600" />
                              <span>
                                Questions (
                                {getVersionQuestionCount(
                                  selectedVersionDetails || selectedVersion,
                                )}
                                )
                              </span>
                            </h3>

                            <div className="grid gap-3 max-h-60 overflow-y-auto">
                              {(
                                (selectedVersionDetails || selectedVersion)
                                  ?.questionVersions || []
                              ).map((q: any, index: number) => {
                                const totalPoints = q.totalPoints || 0;
                                const questionType = q.type || "Unknown";

                                return (
                                  <div
                                    key={q.id || index}
                                    className="bg-gradient-to-r from-gray-50 to-gray-100 p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                                  >
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-2">
                                          <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-1 rounded-full">
                                            Q{index + 1}
                                          </span>
                                          <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded-full">
                                            {questionType}
                                          </span>
                                        </div>
                                        <p className="text-sm text-gray-700 line-clamp-2 font-medium">
                                          {q.question
                                            ? q.question.length > 100
                                              ? `${q.question.substring(0, 100)}...`
                                              : q.question
                                            : "No question text"}
                                        </p>
                                        {q.responseType && (
                                          <p className="text-xs text-gray-500 mt-1">
                                            Response type: {q.responseType}
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right ml-4">
                                        <div className="bg-green-100 text-green-800 text-sm font-semibold px-3 py-1 rounded-full">
                                          {totalPoints} pts
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-indigo-700 font-medium">
                                  Total Points:
                                </span>
                                <span className="text-indigo-900 font-bold text-lg">
                                  {(
                                    (selectedVersionDetails || selectedVersion)
                                      ?.questionVersions || []
                                  ).reduce(
                                    (sum: number, q: any) =>
                                      sum + (q.totalPoints || 0),
                                    0,
                                  )}{" "}
                                  pts
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Configuration */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
                          Configuration
                        </h3>

                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-3 flex items-center space-x-2">
                              <BarChart3 className="h-4 w-4 text-purple-600" />
                              <span>Assignment Settings</span>
                            </label>
                            <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">Graded:</span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .graded
                                      ? "bg-green-100 text-green-700"
                                      : "bg-gray-100 text-gray-700"
                                  }`}
                                >
                                  {(selectedVersionDetails || selectedVersion)
                                    .graded
                                    ? "Yes"
                                    : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Max Attempts:
                                </span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .numAttempts === -1
                                    ? "Unlimited"
                                    : ((
                                        selectedVersionDetails ||
                                        selectedVersion
                                      ).numAttempts ?? "Unlimited")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Attempts Before Cooldown Period:
                                </span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .attemptsBeforeCoolDown === 0
                                    ? "Never wait"
                                    : ((
                                        selectedVersionDetails ||
                                        selectedVersion
                                      ).attemptsBeforeCoolDown ?? "")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Time Learners Wait Between Attempts (Minutes):
                                </span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .attemptsBeforeCoolDown === 0 ||
                                  (selectedVersionDetails || selectedVersion)
                                    .retakeAttemptCoolDownMinutes === 0
                                    ? "Never wait"
                                    : ((
                                        selectedVersionDetails ||
                                        selectedVersion
                                      ).retakeAttemptCoolDownMinutes ?? "")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Passing Grade:
                                </span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .passingGrade || 0}
                                  %
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Time Limit:
                                </span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .allotedTimeMinutes
                                    ? `${(selectedVersionDetails || selectedVersion).allotedTimeMinutes} mins`
                                    : "No limit"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">Display:</span>
                                <span className="font-medium text-gray-900">
                                  {(selectedVersionDetails || selectedVersion)
                                    .questionDisplay || "Default"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-3 flex items-center space-x-2">
                              <Eye className="h-4 w-4 text-green-600" />
                              <span>Learner Visibility</span>
                            </label>
                            <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Assignment Score:
                                </span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .showAssignmentScore
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {(selectedVersionDetails || selectedVersion)
                                    .showAssignmentScore
                                    ? "Visible"
                                    : "Hidden"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Question Scores:
                                </span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .showQuestionScore
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {(selectedVersionDetails || selectedVersion)
                                    .showQuestionScore
                                    ? "Visible"
                                    : "Hidden"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  AI Feedback:
                                </span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .showSubmissionFeedback
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {(selectedVersionDetails || selectedVersion)
                                    .showSubmissionFeedback
                                    ? "Visible"
                                    : "Hidden"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Questions:
                                </span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .showQuestions
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {(selectedVersionDetails || selectedVersion)
                                    .showQuestions
                                    ? "Visible"
                                    : "Hidden"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  Correct Answer Visibility:
                                </span>
                                <span
                                  className={`font-medium px-2 py-1 rounded-full text-xs ${
                                    (selectedVersionDetails || selectedVersion)
                                      .correctAnswerVisibility === "ALWAYS"
                                      ? "bg-green-100 text-green-700"
                                      : (
                                            selectedVersionDetails ||
                                            selectedVersion
                                          ).correctAnswerVisibility === "NEVER"
                                        ? "bg-red-100 text-red-700"
                                        : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {
                                    (selectedVersionDetails || selectedVersion)
                                      .correctAnswerVisibility
                                  }
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3 ">
                    <button
                      onClick={() => setShowDetails(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Close
                    </button>
                    {(selectedVersionDetails || selectedVersion)
                      .versionNumber &&
                      !(selectedVersionDetails || selectedVersion).isActive && (
                        <button
                          onClick={() => {
                            setShowDetails(false);
                            handleActivateVersion(
                              selectedVersionDetails || selectedVersion,
                            );
                          }}
                          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                        >
                          Activate Version
                        </button>
                      )}
                    <button
                      onClick={() => {
                        setShowDetails(false);
                        handleCheckoutVersion(
                          selectedVersion,
                          !selectedVersion.versionNumber,
                        );
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
                    >
                      {(selectedVersionDetails || selectedVersion).versionNumber
                        ? "Check it out"
                        : "Load Draft"}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>

      {/* Unsaved Changes Modal */}
      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        onClose={handleModalClose}
        onSaveAndProceed={handleSaveAndProceed}
        onProceedWithoutSaving={handleProceedWithoutSaving}
        actionType={pendingAction?.type || "checkout"}
        targetName={pendingAction?.targetName}
      />

      {/* Unpublished Activation Modal */}
      <UnpublishedActivationModal
        isOpen={showUnpublishedModal}
        onClose={handleCancelActivation}
        onPublishAndActivate={handlePublishAndActivate}
        onCancel={handleCancelActivation}
        versionNumber={pendingActivationVersion?.versionNumber || 0}
        isSubmitting={isPublishing}
      />

      {/* Delete Version Modal */}
      <AnimatePresence>
        {showDeleteModal && versionToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={cancelDelete}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-red-100 rounded-lg">
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Delete Version
                </h2>
              </div>

              <div className="mb-6">
                <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-5 w-5 text-red-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.502 0L4.232 13.5c-.77.833.192 2.5 1.732 2.5z"
                        />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-red-700">
                        <strong>Warning:</strong> This action is irreversible.
                        Version <strong>{versionToDelete.versionNumber}</strong>{" "}
                        will be permanently deleted.
                      </p>
                    </div>
                  </div>
                </div>

                {versionToDelete.isActive && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      This is the active version. Select a replacement version
                      to activate:
                    </label>
                    <select
                      value={replacementVersionId || ""}
                      onChange={(e) =>
                        setReplacementVersionId(Number(e.target.value))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      required
                    >
                      <option value="">Select a version...</option>
                      {versions
                        .filter((v) => v.id !== versionToDelete.id)
                        .map((version) => (
                          <option key={version.id} value={version.id}>
                            v{version.versionNumber} -{" "}
                            {version.versionDescription || "No description"}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={cancelDelete}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteVersion}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-2"
                  disabled={
                    isDeleting ||
                    (versionToDelete.isActive && !replacementVersionId)
                  }
                >
                  {isDeleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      <span>Delete Version</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Version Modal */}
      <AnimatePresence>
        {showEditModal && versionToEdit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={cancelEdit}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Edit3 className="h-6 w-6 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Edit Version Number
                </h2>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Version Number
                </label>
                <input
                  type="text"
                  value={newVersionNumber}
                  onChange={(e) => setNewVersionNumber(e.target.value)}
                  placeholder="e.g., 1.2.0, 2.0.0-rc1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Current: v{versionToEdit.versionNumber}
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmEditVersion}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                  disabled={
                    !newVersionNumber.trim() ||
                    newVersionNumber === versionToEdit.versionNumber?.toString()
                  }
                >
                  Update Version
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Favorites Modal */}
      <AnimatePresence>
        {showFavoritesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowFavoritesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-yellow-50 to-amber-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-yellow-200 rounded-lg">
                      <Star className="h-6 w-6 text-yellow-600 fill-current" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        Starred Versions
                      </h2>
                      <p className="text-sm text-gray-600">
                        {getFavoriteVersions().length} versions you've marked as
                        important
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowFavoritesModal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-lg hover:bg-gray-100"
                  >
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                {getFavoriteVersions().length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {getFavoriteVersions().map(
                      (version: any, index: number) => {
                        const isCurrentVersion =
                          version.id === currentVersion?.id;
                        const isCheckedOut =
                          version.id === checkedOutVersion?.id;

                        return (
                          <motion.div
                            key={version.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg p-6 border border-yellow-200 hover:border-yellow-300 transition-all duration-200 hover:shadow-lg relative"
                          >
                            {/* Favorite Star Badge */}
                            <div className="absolute top-3 right-3">
                              <button
                                onClick={() =>
                                  toggleFavoriteVersion(version.id)
                                }
                                className="text-yellow-500 hover:text-yellow-600 transition-colors p-1 rounded-full hover:bg-yellow-100"
                                title="Remove from favorites"
                              >
                                <Star className="h-5 w-5 fill-current" />
                              </button>
                            </div>

                            <div className="mb-4">
                              <div className="flex items-center space-x-3 mb-3">
                                <div className="p-2 bg-yellow-200 rounded-lg">
                                  <GitCommit className="h-5 w-5 text-yellow-600" />
                                </div>
                                <div>
                                  <h3 className="font-semibold text-gray-900 text-lg">
                                    v{version.versionNumber}
                                  </h3>
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {isCurrentVersion && (
                                      <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full flex items-center space-x-1">
                                        <CheckCircle className="h-3 w-3" />
                                        <span>Active</span>
                                      </span>
                                    )}
                                    {isCheckedOut && (
                                      <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center space-x-1">
                                        <Eye className="h-3 w-3" />
                                        <span>Checked Out</span>
                                      </span>
                                    )}
                                    {version.isDraft ? (
                                      <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded-full">
                                        Draft
                                      </span>
                                    ) : version.published ? (
                                      <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                                        Published
                                      </span>
                                    ) : (
                                      <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">
                                        Unpublished
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {version.versionDescription && (
                                <p className="text-sm text-gray-700 mb-3 line-clamp-3">
                                  {version.versionDescription}
                                </p>
                              )}

                              <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                                <div className="flex items-center space-x-1">
                                  <Clock className="h-4 w-4" />
                                  <span>
                                    {new Date(
                                      version.createdAt,
                                    ).toLocaleDateString()}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <Activity className="h-4 w-4" />
                                  <span>
                                    {getVersionQuestionCount(version)} questions
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setShowFavoritesModal(false);
                                  handleViewDetails(version, false);
                                }}
                                className="flex items-center space-x-1 px-3 py-2 text-sm font-medium bg-yellow-600 hover:bg-yellow-700 text-white rounded-md transition-colors"
                              >
                                <Eye className="h-4 w-4" />
                                <span>Details</span>
                              </button>
                              <button
                                onClick={() => {
                                  setShowFavoritesModal(false);
                                  handleCheckoutVersion(version, false);
                                }}
                                className="flex items-center space-x-1 px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                              >
                                <CheckCircle className="h-4 w-4" />
                                <span>Edit</span>
                              </button>
                              {!isCurrentVersion && (
                                <button
                                  onClick={() => {
                                    setShowFavoritesModal(false);
                                    handleActivateVersion(version);
                                  }}
                                  className="flex items-center space-x-1 px-3 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
                                  title="Make this version active"
                                >
                                  <span>Activate</span>
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-50 rounded-2xl mx-auto w-fit mb-4">
                      <Star className="h-8 w-8 mx-auto text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No starred versions yet
                    </p>
                    <p className="text-xs text-gray-400">
                      Click the star icon on any version to mark it as a
                      favorite
                    </p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
                <button
                  onClick={() => setShowFavoritesModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
