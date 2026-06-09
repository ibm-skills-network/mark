"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  getAssignmentAnalytics,
  type AssignmentAnalyticsData,
  type AssignmentAnalyticsAggregates,
  type AssignmentAnalyticsSortField,
} from "@/lib/talkToBackend";
import { QuickActions } from "./QuickActions";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Users,
  FileText,
  Star,
  ExternalLink,
  CalendarIcon,
  Filter,
  X,
  SortAsc,
  SortDesc,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

interface AssignmentAnalyticsTableProps {
  sessionToken?: string | null;
  isAdmin?: boolean;
  quickActionResults?: any[] | null;
  quickActionTitle?: string;
  onClearQuickActionResults?: () => void;
  onQuickActionComplete?: (result: any) => void;
  filters?: {
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  };
  onFiltersChange?: (filters: {
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  }) => void;
}

export function AssignmentAnalyticsTable({
  sessionToken,
  quickActionResults,
  quickActionTitle,
  onClearQuickActionResults,
  onQuickActionComplete,
  filters,
  onFiltersChange,
}: AssignmentAnalyticsTableProps) {
  const [data, setData] = useState<AssignmentAnalyticsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedGlobalFilter, setDebouncedGlobalFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState<boolean | undefined>(
    undefined,
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [tablePagination, setTablePagination] = useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [serverPageCount, setServerPageCount] = useState(1);
  const [serverRowCount, setServerRowCount] = useState(0);
  const [aggregates, setAggregates] =
    useState<AssignmentAnalyticsAggregates | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters || {});

  const isShowingQuickActionResults = !!quickActionResults;
  const currentQuickActionTitle = quickActionTitle;

  // Snap back to page 1: filters/sorts change the result set, so the current
  // page could fall out of range. Called at each change site (not in a separate
  // effect) so the page reset and the filter change land in the same render —
  // React 19 batches them, so the data effect fires one fetch, not two.
  const goToFirstPage = useCallback(() => {
    setTablePagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 },
    );
  }, []);

  // Full reset to the default server view (clearing all filters, or leaving
  // quick-action results).
  const resetServerView = useCallback(() => {
    setGlobalFilter("");
    setDebouncedGlobalFilter("");
    setPublishedFilter(undefined);
    setSorting([]);
    setTablePagination({ pageIndex: 0, pageSize: PAGE_SIZE });
  }, []);

  // Debounce: 300ms idle before search syncs to the server.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedGlobalFilter(globalFilter);
      goToFirstPage();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [globalFilter, goToFirstPage]);

  useEffect(() => {
    setLocalFilters(filters || {});
  }, [filters]);

  // Sequence guard: overlapping requests (rapid paging/filtering) can resolve
  // out of order, so only the most-recently-issued request is allowed to write
  // state — a stale response is dropped instead of clobbering newer data.
  const latestRequestId = useRef(0);

  const fetchData = async () => {
    if (!sessionToken) return;
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const sortState = sorting[0];
      const response = await getAssignmentAnalytics(
        sessionToken,
        tablePagination.pageIndex + 1,
        PAGE_SIZE,
        debouncedGlobalFilter || undefined,
        {
          sortBy: sortState?.id as AssignmentAnalyticsSortField | undefined,
          sortOrder: sortState ? (sortState.desc ? "desc" : "asc") : undefined,
          published: publishedFilter,
        },
      );
      if (requestId !== latestRequestId.current) return;
      setData(response.data);
      setServerPageCount(response.pagination.totalPages);
      setServerRowCount(response.pagination.total);
      setAggregates(response.aggregates);

      // Page clamp: if the new filter made the current page fall off the end,
      // snap back to the last valid page.
      if (
        response.pagination.totalPages > 0 &&
        tablePagination.pageIndex >= response.pagination.totalPages
      ) {
        setTablePagination((prev) => ({
          ...prev,
          pageIndex: response.pagination.totalPages - 1,
        }));
      }
    } catch (err) {
      if (requestId !== latestRequestId.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch assignment analytics",
      );
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isShowingQuickActionResults) {
      fetchData();
    }
  }, [
    sessionToken,
    isShowingQuickActionResults,
    tablePagination.pageIndex,
    sorting,
    publishedFilter,
    debouncedGlobalFilter,
  ]);

  const handleClearQuickActionResults = () => {
    onClearQuickActionResults?.();
    resetServerView();
  };

  const handleFilterChange = (key: string, value: string | number) => {
    const newFilters = {
      ...localFilters,
      [key]: value === "" ? undefined : value,
    };
    setLocalFilters(newFilters);
  };

  const applyFilters = () => {
    onFiltersChange?.(localFilters);
  };

  const rawData = quickActionResults || data;

  // Stable identities so the `columns` memo below isn't rebuilt every render.
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount);
  }, []);

  const formatPercentage = useCallback((value: number) => {
    return `${Math.round(value)}%`;
  }, []);

  const navigateToInsights = useCallback((assignmentId: number) => {
    window.open(`/admin/insights/${assignmentId}`, "_blank");
  }, []);

  const columnHelper = createColumnHelper<AssignmentAnalyticsData>();

  const columns = useMemo<ColumnDef<AssignmentAnalyticsData, any>[]>(
    () => [
      columnHelper.accessor("name", {
        header: "Assignment",
        cell: ({ getValue, row }) => (
          <div className="min-w-[200px]">
            <div className="font-medium">{getValue()}</div>
            <div className="text-sm text-muted-foreground">
              ID: {row.original.id}
            </div>
          </div>
        ),
        enableSorting: true,
      }),

      columnHelper.accessor("published", {
        header: "Status",
        cell: ({ getValue }) => (
          <Badge
            variant={getValue() ? "default" : "secondary"}
            className={
              getValue()
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-800"
            }
          >
            {getValue() ? "Published" : "Draft"}
          </Badge>
        ),
        enableSorting: true,
      }),

      // Derived/computed columns: sort disabled because the backend doesn't
      // sort by these (they're computed in JS from batched per-page stats).
      columnHelper.display({
        id: "costPerAttempt",
        header: "Cost/Attempt",
        cell: ({ row }) => {
          const assignment = row.original;
          return (
            <div className="text-right font-mono">
              <div className="flex items-center justify-end">
                {assignment.totalAttempts > 0
                  ? formatCurrency(
                      assignment.totalCost / assignment.totalAttempts,
                    )
                  : "N/A"}
              </div>
              {assignment.totalAttempts > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  {assignment.totalAttempts} attempts
                </div>
              )}
            </div>
          );
        },
        enableSorting: false,
      }),
      columnHelper.accessor("totalCost", {
        header: "Total Cost",
        cell: ({ getValue, row }) => (
          <div className="text-right font-mono">
            <div className="flex items-center justify-end">
              {formatCurrency(getValue())}
            </div>
            {row.original.insights?.costBreakdown && (
              <div className="text-xs text-muted-foreground mt-1">
                Grading:{" "}
                {formatCurrency(row.original.insights.costBreakdown.grading)}
              </div>
            )}
          </div>
        ),
        enableSorting: false,
      }),

      columnHelper.accessor("uniqueLearners", {
        header: "Learners",
        cell: ({ getValue }) => (
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Users className="h-3 w-3" />
              {getValue()}
            </div>
          </div>
        ),
        enableSorting: false,
      }),

      columnHelper.accessor("totalAttempts", {
        header: "Attempts",
        cell: ({ getValue, row }) => (
          <div className="text-center">
            <div className="space-y-1">
              <div className="font-medium">{getValue()}</div>
              <div className="text-xs text-muted-foreground">
                {row.original.completedAttempts} completed
              </div>
            </div>
          </div>
        ),
        enableSorting: false,
      }),

      columnHelper.display({
        id: "completion",
        header: "Completion",
        cell: ({ row }) => {
          const assignment = row.original;
          const completionRate =
            assignment.totalAttempts > 0
              ? (assignment.completedAttempts / assignment.totalAttempts) * 100
              : 0;
          return (
            <div className="text-center">
              <div className="space-y-1">
                <div className="font-medium">
                  {formatPercentage(completionRate)}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            </div>
          );
        },
        enableSorting: false,
      }),

      columnHelper.accessor("averageGrade", {
        header: "Avg Grade",
        cell: ({ getValue }) => {
          const grade = getValue();
          return (
            <div className="text-center">
              <div className="space-y-1">
                <div className="font-medium">
                  {grade > 0 ? formatPercentage(grade) : "N/A"}
                </div>
                {grade > 0 && (
                  <div className="flex justify-center">
                    <div className="w-full bg-gray-200 rounded-full h-1.5 max-w-[60px]">
                      <div
                        className={`h-1.5 rounded-full ${
                          grade >= 80
                            ? "bg-green-500"
                            : grade >= 60
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                        style={{ width: `${grade}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        },
        enableSorting: false,
      }),

      columnHelper.accessor("averageRating", {
        header: "Rating",
        cell: ({ getValue }) => (
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <span className="font-medium">
                {getValue() > 0 ? getValue().toFixed(1) : "N/A"}
              </span>
            </div>
          </div>
        ),
        enableSorting: false,
      }),

      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="text-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateToInsights(row.original.id)}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              Insights
            </Button>
          </div>
        ),
      }),
    ],
    [formatCurrency, formatPercentage, navigateToInsights],
  );

  // Server-driven mode for the normal analytics view; client-side for the
  // bounded quick-action result set (no pagination, no sort/filter UI).
  const table = useReactTable({
    data: rawData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: !isShowingQuickActionResults,
    manualSorting: !isShowingQuickActionResults,
    manualFiltering: !isShowingQuickActionResults,
    pageCount: isShowingQuickActionResults ? 1 : serverPageCount,
    rowCount: isShowingQuickActionResults ? rawData.length : serverRowCount,
    onSortingChange: (updater) => {
      setSorting(updater);
      goToFirstPage();
    },
    onPaginationChange: setTablePagination,
    state: {
      sorting,
      pagination: tablePagination,
    },
  });

  const hasAdvancedFilters = Object.values(filters || {}).some(
    (value) => value !== undefined && value !== "",
  );
  const hasTableFilters =
    !!debouncedGlobalFilter || publishedFilter !== undefined;

  if (loading && !isShowingQuickActionResults && data.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-muted-foreground">
            Loading assignment analytics...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-red-600">Error: {error}</div>
        </div>
      </div>
    );
  }

  const showingFrom =
    serverRowCount === 0 ? 0 : tablePagination.pageIndex * PAGE_SIZE + 1;
  const showingTo = Math.min(
    (tablePagination.pageIndex + 1) * PAGE_SIZE,
    serverRowCount,
  );

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Filters & Search</CardTitle>
            <div className="flex items-center gap-2">
              {!isShowingQuickActionResults && (
                <QuickActions
                  sessionToken={sessionToken}
                  onActionComplete={onQuickActionComplete}
                />
              )}

              {isShowingQuickActionResults && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-800"
                  >
                    Quick Action Results: {currentQuickActionTitle}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearQuickActionResults}
                  >
                    Clear Results
                  </Button>
                </div>
              )}

              {!isShowingQuickActionResults && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2"
                >
                  <Filter className="h-4 w-4" />
                  {showFilters ? "Hide" : "Show"} Advanced Filters
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Search, status filter, and advanced filters are server-driven —
            hidden for quick-action results because that data has its own
            shape and is already pre-ranked. */}
        {!isShowingQuickActionResults && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Global Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search assignments by name or ID..."
                  value={globalFilter ?? ""}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="pl-10"
                />

                {globalFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setGlobalFilter("");
                      setDebouncedGlobalFilter("");
                      goToFirstPage();
                    }}
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Status Filter
                </label>
                <select
                  value={
                    publishedFilter === true
                      ? "published"
                      : publishedFilter === false
                        ? "draft"
                        : "all"
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    setPublishedFilter(
                      value === "all" ? undefined : value === "published",
                    );
                    goToFirstPage();
                  }}
                  className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
                >
                  <option value="all">All Assignments</option>
                  <option value="published">Published Only</option>
                  <option value="draft">Draft Only</option>
                </select>
                <div className="text-xs text-muted-foreground">25 per page</div>
              </div>
            </div>

            {showFilters && (
              <div className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      Date Range
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <CalendarIcon className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input
                          type="date"
                          placeholder="Start Date"
                          value={localFilters.startDate || ""}
                          onChange={(e) =>
                            handleFilterChange("startDate", e.target.value)
                          }
                          className="pl-10"
                        />
                      </div>
                      <div className="relative flex-1">
                        <CalendarIcon className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input
                          type="date"
                          placeholder="End Date"
                          value={localFilters.endDate || ""}
                          onChange={(e) =>
                            handleFilterChange("endDate", e.target.value)
                          }
                          className="pl-10"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      Assignment
                    </label>
                    <div className="space-y-2">
                      <Input
                        type="number"
                        placeholder="Assignment ID"
                        value={localFilters.assignmentId || ""}
                        onChange={(e) =>
                          handleFilterChange(
                            "assignmentId",
                            e.target.value ? parseInt(e.target.value, 10) : "",
                          )
                        }
                      />

                      <Input
                        type="text"
                        placeholder="Assignment Name"
                        value={localFilters.assignmentName || ""}
                        onChange={(e) =>
                          handleFilterChange("assignmentName", e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      User
                    </label>
                    <Input
                      type="text"
                      placeholder="User ID or Email"
                      value={localFilters.userId || ""}
                      onChange={(e) =>
                        handleFilterChange("userId", e.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button onClick={applyFilters} size="sm">
                    Apply Advanced Filters
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setLocalFilters(filters || {})}
                    size="sm"
                  >
                    Reset Advanced
                  </Button>
                </div>

                {hasAdvancedFilters && (
                  <div className="border-t pt-4">
                    <div className="text-sm text-muted-foreground mb-2">
                      Active Advanced Filters:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filters?.startDate && (
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                          From: {filters.startDate}
                        </span>
                      )}
                      {filters?.endDate && (
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                          To: {filters.endDate}
                        </span>
                      )}
                      {filters?.assignmentId && (
                        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                          Assignment ID: {filters.assignmentId}
                        </span>
                      )}
                      {filters?.assignmentName && (
                        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                          Assignment: {filters.assignmentName}
                        </span>
                      )}
                      {filters?.userId && (
                        <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                          User: {filters.userId}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasTableFilters && (
              <div className="border-t pt-4">
                <div className="text-sm text-muted-foreground mb-2">
                  Active Filters:
                </div>
                <div className="flex flex-wrap gap-2">
                  {debouncedGlobalFilter && (
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                      Search: {debouncedGlobalFilter}
                    </span>
                  )}
                  {publishedFilter !== undefined && (
                    <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
                      Status: {publishedFilter ? "Published" : "Draft"}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetServerView}
                    className="h-6 px-2 text-xs"
                  >
                    Clear All Filters
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Aggregate cards reflect the full filtered server-side dataset, not
          the current page. Hidden in quick-action mode because that data
          has a different shape and would render NaN for most cards. */}
      {!isShowingQuickActionResults && rawData.length > 0 && aggregates && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">
                  {aggregates.totalAssignments}
                </div>
                <div className="text-sm text-muted-foreground">
                  {hasTableFilters
                    ? "Filtered Assignments"
                    : "Total Assignments"}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <div>
                <div className="text-2xl font-bold">
                  {formatCurrency(aggregates.totalCost).replace("$", "")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {hasTableFilters ? "Filtered Cost" : "Total Cost"}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">
                  {aggregates.totalLearnerAssignmentPairs}
                </div>
                <div className="text-sm text-muted-foreground">
                  {hasTableFilters
                    ? "Filtered Learner-Assignment Pairs"
                    : "Total Learner-Assignment Pairs"}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">
                  {aggregates.averageRating > 0
                    ? aggregates.averageRating.toFixed(1)
                    : "N/A"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {hasTableFilters ? "Filtered Avg Rating" : "Avg Rating"}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {isShowingQuickActionResults
                ? "Quick Action Results"
                : "Assignment Analytics"}
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {isShowingQuickActionResults
                ? `${rawData.length} ${rawData.length === 1 ? "result" : "results"}`
                : serverRowCount === 0
                  ? "No assignments"
                  : `Showing ${showingFrom}–${showingTo} of ${serverRowCount} assignments`}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rawData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isShowingQuickActionResults
                ? "No results found for this quick action"
                : "No assignment analytics found"}
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className={`overflow-hidden rounded-lg border border-gray-200 ${
                  loading && data.length > 0 && !isShowingQuickActionResults
                    ? "opacity-60 pointer-events-none transition-opacity"
                    : ""
                }`}
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                          {headerGroup.headers.map((header) => {
                            const canSort =
                              !isShowingQuickActionResults &&
                              header.column.getCanSort();
                            return (
                              <th
                                key={header.id}
                                className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider transition-colors ${
                                  canSort
                                    ? "cursor-pointer hover:bg-gray-100"
                                    : ""
                                }`}
                                onClick={
                                  canSort
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
                                  {canSort && (
                                    <span className="flex flex-col">
                                      {{
                                        asc: (
                                          <SortAsc className="h-3 w-3 text-gray-400" />
                                        ),

                                        desc: (
                                          <SortDesc className="h-3 w-3 text-gray-400" />
                                        ),
                                      }[
                                        header.column.getIsSorted() as string
                                      ] ?? (
                                        <div className="flex flex-col">
                                          <ChevronUp className="h-2 w-2 text-gray-300" />
                                          <ChevronDown className="h-2 w-2 text-gray-300 -mt-1" />
                                        </div>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      ))}
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {table.getRowModel().rows.map((row) => (
                        <tr
                          key={row.id}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {!isShowingQuickActionResults && table.getPageCount() > 1 && (
                <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-700">
                      Page {tablePagination.pageIndex + 1} of{" "}
                      {table.getPageCount()}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
