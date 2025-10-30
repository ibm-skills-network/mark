"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  getAssignmentAnalytics,
  type AssignmentAnalyticsData,
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
  isAdmin,
  quickActionResults,
  quickActionTitle,
  onClearQuickActionResults,
  onQuickActionComplete,
  filters,
  onFiltersChange,
}: AssignmentAnalyticsTableProps) {
  const router = useRouter();
  const [data, setData] = useState<AssignmentAnalyticsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [tablePagination, setTablePagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters || {});

  const fetchData = async () => {
    if (!sessionToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await getAssignmentAnalytics(
        sessionToken,
        1,
        1000,
        undefined,
      );
      setData(response.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch assignment analytics",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!quickActionResults) {
      fetchData();
    }
  }, [sessionToken, quickActionResults]);

  useEffect(() => {
    setLocalFilters(filters || {});
  }, [filters]);

  const handleClearQuickActionResults = () => {
    if (onClearQuickActionResults) {
      onClearQuickActionResults();
    }

    fetchData();
  };

  const handleFilterChange = (key: string, value: string | number) => {
    const newFilters = {
      ...localFilters,
      [key]: value === "" ? undefined : value,
    };
    setLocalFilters(newFilters);
  };

  const applyFilters = () => {
    if (onFiltersChange) {
      onFiltersChange(localFilters);
    }
  };

  const rawData = quickActionResults || data;
  const isShowingQuickActionResults = !!quickActionResults;
  const currentQuickActionTitle = quickActionTitle;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${Math.round(value)}%`;
  };

  const navigateToInsights = (assignmentId: number) => {
    window.open(`/admin/insights/${assignmentId}`, "_blank");
  };

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
        filterFn: "equals",
      }),
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
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original;
          const b = rowB.original;
          const aValue =
            a.totalAttempts > 0 ? a.totalCost / a.totalAttempts : 0;
          const bValue =
            b.totalAttempts > 0 ? b.totalCost / b.totalAttempts : 0;
          return aValue - bValue;
        },
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

        enableSorting: true,
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

        enableSorting: true,
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

        enableSorting: true,
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
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original;
          const b = rowB.original;
          const aCompletion =
            a.totalAttempts > 0
              ? (a.completedAttempts / a.totalAttempts) * 100
              : 0;
          const bCompletion =
            b.totalAttempts > 0
              ? (b.completedAttempts / b.totalAttempts) * 100
              : 0;
          return aCompletion - bCompletion;
        },
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
        enableSorting: true,
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

        enableSorting: true,
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

  const table = useReactTable({
    data: rawData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setTablePagination,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination: tablePagination,
    },
    globalFilterFn: (row, _columnId, value) => {
      const assignment = row.original;
      const searchValue = value.toLowerCase();

      const nameMatch = assignment.name.toLowerCase().includes(searchValue);

      const idMatch = assignment.id.toString().includes(searchValue);

      return nameMatch || idMatch;
    },
  });

  const hasActiveFilters = Object.values(filters || {}).some(
    (value) => value !== undefined && value !== "",
  );

  if (loading && !quickActionResults && data.length === 0) {
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

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                {showFilters ? "Hide" : "Show"} Advanced Filters
              </Button>
            </div>
          </div>
        </CardHeader>
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
                  onClick={() => setGlobalFilter("")}
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Status Filter
              </label>
              <select
                value={
                  (table.getColumn("published")?.getFilterValue() as
                    | boolean
                    | undefined) === true
                    ? "published"
                    : (table.getColumn("published")?.getFilterValue() as
                          | boolean
                          | undefined) === false
                      ? "draft"
                      : "all"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "all") {
                    table.getColumn("published")?.setFilterValue(undefined);
                  } else {
                    table
                      .getColumn("published")
                      ?.setFilterValue(value === "published");
                  }
                }}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="all">All Assignments</option>
                <option value="published">Published Only</option>
                <option value="draft">Draft Only</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Items per Page
              </label>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => {
                  table.setPageSize(Number(e.target.value));
                }}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
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
                          e.target.value ? parseInt(e.target.value) : "",
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

              {hasActiveFilters && (
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

          {(globalFilter ||
            table.getColumn("published")?.getFilterValue() !== undefined) && (
            <div className="border-t pt-4">
              <div className="text-sm text-muted-foreground mb-2">
                Active Filters:
              </div>
              <div className="flex flex-wrap gap-2">
                {globalFilter && (
                  <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                    Search: {globalFilter}
                  </span>
                )}
                {table.getColumn("published")?.getFilterValue() !==
                  undefined && (
                  <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
                    Status:{" "}
                    {table.getColumn("published")?.getFilterValue()
                      ? "Published"
                      : "Draft"}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGlobalFilter("");
                    table.resetColumnFilters();
                  }}
                  className="h-6 px-2 text-xs"
                >
                  Clear All Filters
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {rawData && rawData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">
                  {table.getFilteredRowModel().rows.length}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalFilter ||
                  table.getColumn("published")?.getFilterValue() !== undefined
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
                  {formatCurrency(
                    table
                      .getFilteredRowModel()
                      .rows.reduce(
                        (sum, row) => sum + row.original.totalCost,
                        0,
                      ),
                  ).replace("$", "")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalFilter ||
                  table.getColumn("published")?.getFilterValue() !== undefined
                    ? "Filtered Cost"
                    : "Total Cost"}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">
                  {table
                    .getFilteredRowModel()
                    .rows.reduce(
                      (sum, row) => sum + row.original.uniqueLearners,
                      0,
                    )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalFilter ||
                  table.getColumn("published")?.getFilterValue() !== undefined
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
                  {(() => {
                    const filteredData = table
                      .getFilteredRowModel()
                      .rows.map((row) => row.original);
                    const validRatings = filteredData.filter(
                      (a) => a.averageRating > 0,
                    );
                    if (validRatings.length === 0) return "N/A";
                    const avgRating =
                      validRatings.reduce(
                        (sum, a) => sum + a.averageRating,
                        0,
                      ) / validRatings.length;
                    return avgRating.toFixed(1);
                  })()}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalFilter ||
                  table.getColumn("published")?.getFilterValue() !== undefined
                    ? "Filtered Avg Rating"
                    : "Avg Rating"}
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
              My Assignment Analytics
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              Showing {table.getFilteredRowModel().rows.length} of{" "}
              {rawData.length} assignments
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
                          ))}
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

              {table.getFilteredRowModel().rows.length === 0 &&
                rawData.length > 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-50 rounded-2xl mx-auto w-fit mb-4">
                      <Search className="h-8 w-8 mx-auto text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No assignments match your filters
                    </p>
                    <p className="text-xs text-gray-400">
                      Try adjusting your search terms or filters
                    </p>
                  </div>
                )}

              {table.getPageCount() > 1 && (
                <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-700">
                      Page {table.getState().pagination.pageIndex + 1} of{" "}
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
