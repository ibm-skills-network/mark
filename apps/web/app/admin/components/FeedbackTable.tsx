"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  SortAsc,
  SortDesc,
  ChevronUp,
  ChevronDown,
  X,
  Star,
  CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  getAdminFeedback,
  type FeedbackData,
  type FeedbackFilters,
} from "@/lib/talkToBackend";
import { FeedbackModal } from "@/components/modals/FeedbackModal";

interface FeedbackTableProps {
  sessionToken?: string | null;
}

export function FeedbackTable({ sessionToken }: FeedbackTableProps) {
  const [feedback, setFeedback] = useState<FeedbackData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [tablePagination, setTablePagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  });
  const [assignmentIdFilter, setAssignmentIdFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackData | null>(
    null,
  );
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  const getRatingStars = (rating: number) => {
    return "★".repeat(rating) + "☆".repeat(5 - rating);
  };

  const openFeedbackModal = (feedbackItem: FeedbackData) => {
    setSelectedFeedback(feedbackItem);
    setIsFeedbackModalOpen(true);
  };

  const closeFeedbackModal = () => {
    setIsFeedbackModalOpen(false);
    setSelectedFeedback(null);
  };

  const fetchFeedback = async () => {
    if (!sessionToken) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getAdminFeedback(
        { page: 1, limit: 1000 },
        undefined,
        sessionToken,
      );

      setFeedback(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch feedback");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
  }, [sessionToken]);

  const columnHelper = createColumnHelper<FeedbackData>();

  const columns = useMemo<ColumnDef<FeedbackData, any>[]>(
    () => [
      columnHelper.display({
        id: "assignment",
        header: "Assignment",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.assignment.name}</div>
            <div className="text-sm text-muted-foreground">
              ID: {row.original.assignment.id}
            </div>
          </div>
        ),

        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.assignment.name;
          const b = rowB.original.assignment.name;
          return a.localeCompare(b);
        },
      }),

      columnHelper.accessor("userId", {
        header: "User ID",
        cell: ({ getValue }) => (
          <div className="font-mono text-sm">{getValue()}</div>
        ),

        enableSorting: true,
      }),

      columnHelper.accessor("comments", {
        header: "Comments",
        cell: ({ getValue }) => (
          <div className="max-w-xs truncate">{getValue()}</div>
        ),

        enableSorting: true,
      }),

      columnHelper.display({
        id: "ratings",
        header: "Ratings",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="text-sm flex items-center gap-1">
              <span className="text-muted-foreground">AI:</span>
              <div className="flex items-center">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-3 w-3 ${
                      i < row.original.aiGradingRating
                        ? "fill-yellow-400 text-yellow-400"
                        : "fill-gray-200 text-gray-200"
                    }`}
                  />
                ))}
                <span className="ml-1 text-xs">
                  ({row.original.aiGradingRating})
                </span>
              </div>
            </div>
            <div className="text-sm flex items-center gap-1">
              <span className="text-muted-foreground">Assignment:</span>
              <div className="flex items-center">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-3 w-3 ${
                      i < row.original.assignmentRating
                        ? "fill-yellow-400 text-yellow-400"
                        : "fill-gray-200 text-gray-200"
                    }`}
                  />
                ))}
                <span className="ml-1 text-xs">
                  ({row.original.assignmentRating})
                </span>
              </div>
            </div>
          </div>
        ),

        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a =
            (rowA.original.aiGradingRating + rowA.original.assignmentRating) /
            2;
          const b =
            (rowB.original.aiGradingRating + rowB.original.assignmentRating) /
            2;
          return a - b;
        },
      }),

      columnHelper.accessor("allowContact", {
        header: "Contact Info",
        cell: ({ getValue, row }) => {
          if (getValue()) {
            return (
              <div>
                <div className="font-medium">
                  {row.original.firstName} {row.original.lastName}
                </div>
                <div className="text-sm text-muted-foreground">
                  {row.original.email}
                </div>
              </div>
            );
          } else {
            return <Badge variant="secondary">No contact</Badge>;
          }
        },
        enableSorting: true,
        filterFn: "equals",
      }),

      columnHelper.display({
        id: "grade",
        header: "Grade",
        cell: ({ row }) => (
          <Badge variant="outline">
            {(row.original.assignmentAttempt.grade * 100).toFixed(1)}%
          </Badge>
        ),

        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.assignmentAttempt.grade;
          const b = rowB.original.assignmentAttempt.grade;
          return a - b;
        },
      }),

      columnHelper.accessor("createdAt", {
        header: "Date",
        cell: ({ getValue }) => (
          <div>
            <div className="text-sm">
              {new Date(getValue()).toLocaleDateString()}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(getValue()).toLocaleTimeString()}
            </div>
          </div>
        ),

        enableSorting: true,
      }),

      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openFeedbackModal(row.original)}
          >
            View Details
          </Button>
        ),
      }),
    ],

    [getRatingStars, openFeedbackModal],
  );

  const globalFilterFn = useMemo(() => {
    return (row: any, _columnId: string, value: string) => {
      const feedbackItem = row.original;
      const searchValue = value?.toLowerCase() || "";

      if (
        assignmentIdFilter &&
        feedbackItem.assignment.id.toString() !== assignmentIdFilter
      ) {
        return false;
      }

      const itemDate = new Date(feedbackItem.createdAt);
      if (startDate && itemDate < new Date(startDate)) {
        return false;
      }
      if (endDate && itemDate > new Date(endDate + "T23:59:59")) {
        return false;
      }

      if (!value) return true;

      const commentsMatch = feedbackItem.comments
        .toLowerCase()
        .includes(searchValue);
      const userMatch = feedbackItem.userId.toLowerCase().includes(searchValue);
      const assignmentMatch = feedbackItem.assignment.name
        .toLowerCase()
        .includes(searchValue);
      const assignmentIdMatch = feedbackItem.assignment.id
        .toString()
        .includes(searchValue);
      const emailMatch =
        feedbackItem.email?.toLowerCase().includes(searchValue) || false;
      const nameMatch =
        `${feedbackItem.firstName || ""} ${feedbackItem.lastName || ""}`
          .toLowerCase()
          .includes(searchValue);

      return (
        commentsMatch ||
        userMatch ||
        assignmentMatch ||
        assignmentIdMatch ||
        emailMatch ||
        nameMatch
      );
    };
  }, [assignmentIdFilter, startDate, endDate]);

  const table = useReactTable({
    data: feedback,
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
    globalFilterFn,
  });

  useEffect(() => {
    const currentFilter = globalFilter || "";
    table.setGlobalFilter(currentFilter + " ");
    table.setGlobalFilter(currentFilter);
  }, [assignmentIdFilter, startDate, endDate, table, globalFilter]);

  const exportToCSV = () => {
    const filteredData = table
      .getFilteredRowModel()
      .rows.map((row) => row.original);

    const headers = [
      "ID",
      "Assignment Name",
      "User ID",
      "Comments",
      "AI Grading Rating",
      "Assignment Rating",
      "Allow Contact",
      "First Name",
      "Last Name",
      "Email",
      "Grade",
      "Created At",
    ];

    const csvContent = [
      headers.join(","),
      ...filteredData.map((item) =>
        [
          item.id,
          `"${item.assignment.name}"`,
          item.userId,
          `"${item.comments}"`,
          item.aiGradingRating,
          item.assignmentRating,
          item.allowContact,
          item.firstName || "",
          item.lastName || "",
          item.email || "",
          item.assignmentAttempt.grade,
          new Date(item.createdAt).toLocaleString(),
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedback_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading && feedback.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-muted-foreground">Loading feedback...</div>
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
            <CardTitle className="text-lg">Feedback Management</CardTitle>
            <div className="flex items-center gap-2">
              <Button onClick={exportToCSV} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export CSV
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
                placeholder="Search feedback by comments, user, assignment, or contact info..."
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Contact Preference Filter
              </label>
              <select
                value={
                  (table.getColumn("allowContact")?.getFilterValue() as
                    | boolean
                    | undefined) === true
                    ? "true"
                    : (table.getColumn("allowContact")?.getFilterValue() as
                          | boolean
                          | undefined) === false
                      ? "false"
                      : "all"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "all") {
                    table.getColumn("allowContact")?.setFilterValue(undefined);
                  } else {
                    table
                      .getColumn("allowContact")
                      ?.setFilterValue(value === "true");
                  }
                }}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="all">All Contact Preferences</option>
                <option value="true">Allow Contact</option>
                <option value="false">No Contact</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Assignment ID
              </label>
              <Input
                type="number"
                placeholder="Filter by Assignment ID"
                value={assignmentIdFilter}
                onChange={(e) => setAssignmentIdFilter(e.target.value)}
                className="w-full"
              />
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
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Start Date
              </label>
              <div className="relative">
                <CalendarIcon className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  type="date"
                  placeholder="Start Date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                End Date
              </label>
              <div className="relative">
                <CalendarIcon className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  type="date"
                  placeholder="End Date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          {(globalFilter ||
            table.getColumn("allowContact")?.getFilterValue() !== undefined ||
            assignmentIdFilter ||
            startDate ||
            endDate) && (
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
                {table.getColumn("allowContact")?.getFilterValue() !==
                  undefined && (
                  <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                    Contact:{" "}
                    {table.getColumn("allowContact")?.getFilterValue()
                      ? "Allow"
                      : "No Contact"}
                  </span>
                )}
                {assignmentIdFilter && (
                  <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                    Assignment ID: {assignmentIdFilter}
                  </span>
                )}
                {startDate && (
                  <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded">
                    From: {startDate}
                  </span>
                )}
                {endDate && (
                  <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded">
                    To: {endDate}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGlobalFilter("");
                    table.resetColumnFilters();
                    setAssignmentIdFilter("");
                    setStartDate("");
                    setEndDate("");
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">Feedback</CardTitle>
            <div className="text-sm text-muted-foreground">
              Showing {table.getFilteredRowModel().rows.length} of{" "}
              {feedback.length} feedback entries
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {feedback.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No feedback found
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
                feedback.length > 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-50 rounded-2xl mx-auto w-fit mb-4">
                      <Search className="h-8 w-8 mx-auto text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No feedback matches your filters
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

      <FeedbackModal
        feedback={selectedFeedback}
        isOpen={isFeedbackModalOpen}
        onClose={closeFeedbackModal}
      />
    </div>
  );
}
