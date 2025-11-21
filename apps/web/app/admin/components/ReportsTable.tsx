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
  getAdminReports,
  type ReportData,
  type ReportsFilters,
} from "@/lib/talkToBackend";
import { ReportModal } from "@/components/modals/ReportModal";

interface ReportsTableProps {
  sessionToken?: string | null;
}

export function ReportsTable({ sessionToken }: ReportsTableProps) {
  const [reports, setReports] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [tablePagination, setTablePagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedReport, setSelectedReport] = useState<ReportData | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const getStatusBadge = (status: string) => {
    const statusVariants = {
      OPEN: "destructive" as const,
      IN_PROGRESS: "secondary" as const,
      CLOSED: "default" as const,
      RESOLVED: "outline" as const,
    };

    return (
      <Badge variant={statusVariants[status] || "secondary"}>
        {status.replace("_", " ")}
      </Badge>
    );
  };

  const getIssueTypeBadge = (issueType: string) => {
    const typeVariants = {
      BUG: "destructive" as const,
      FEATURE_REQUEST: "default" as const,
      QUESTION: "secondary" as const,
      FEEDBACK: "outline" as const,
    };

    return (
      <Badge variant={typeVariants[issueType] || "secondary"}>
        {issueType.replace("_", " ")}
      </Badge>
    );
  };

  const openReportModal = (reportItem: ReportData) => {
    setSelectedReport(reportItem);
    setIsReportModalOpen(true);
  };

  const closeReportModal = () => {
    setIsReportModalOpen(false);
    setSelectedReport(null);
  };

  const fetchReports = async () => {
    if (!sessionToken) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getAdminReports(
        { page: 1, limit: 1000 },
        undefined,
        sessionToken,
      );

      setReports(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [sessionToken]);

  const columnHelper = createColumnHelper<ReportData>();

  const columns = useMemo<ColumnDef<ReportData, any>[]>(
    () => [
      columnHelper.accessor("id", {
        header: "ID",
        cell: ({ getValue, row }) => (
          <div>
            <div className="font-medium">#{getValue()}</div>
            {row.original.issueNumber && (
              <div className="text-sm text-muted-foreground">
                GitHub: #{row.original.issueNumber}
              </div>
            )}
          </div>
        ),

        enableSorting: true,
      }),

      columnHelper.accessor("reporterId", {
        header: "Reporter",
        cell: ({ getValue, row }) => (
          <div>
            <div className="font-mono text-sm">{getValue()}</div>
            {row.original.author && (
              <Badge variant="secondary" className="text-xs">
                Author
              </Badge>
            )}
          </div>
        ),

        enableSorting: true,
      }),

      columnHelper.display({
        id: "assignment",
        header: "Assignment",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.assignment?.name || "N/A"}
            </div>
            {row.original.assignment && (
              <div className="text-sm text-muted-foreground">
                ID: {row.original.assignment.id}
              </div>
            )}
          </div>
        ),

        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.assignment?.name || "";
          const b = rowB.original.assignment?.name || "";
          return a.localeCompare(b);
        },
      }),

      columnHelper.accessor("issueType", {
        header: "Issue Type",
        cell: ({ getValue }) => getIssueTypeBadge(getValue()),
        enableSorting: true,
        filterFn: "equals",
      }),

      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => getStatusBadge(getValue()),
        enableSorting: true,
        filterFn: "equals",
      }),

      columnHelper.accessor("description", {
        header: "Description",
        cell: ({ getValue, row }) => (
          <div className="max-w-md">
            <div className="truncate">{getValue()}</div>
            {row.original.statusMessage && (
              <div className="text-xs text-muted-foreground mt-1 truncate">
                Status: {row.original.statusMessage}
              </div>
            )}
          </div>
        ),

        enableSorting: true,
      }),

      columnHelper.accessor("createdAt", {
        header: "Created",
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
            onClick={() => openReportModal(row.original)}
          >
            View Details
          </Button>
        ),
      }),
    ],

    [getStatusBadge, getIssueTypeBadge, openReportModal],
  );

  const globalFilterFn = useMemo(() => {
    return (row: any, _columnId: string, value: string) => {
      const report = row.original;
      const searchValue = value?.toLowerCase() || "";

      const itemDate = new Date(report.createdAt);
      if (startDate && itemDate < new Date(startDate)) {
        return false;
      }
      if (endDate && itemDate > new Date(endDate + "T23:59:59")) {
        return false;
      }

      if (!value) return true;

      const descriptionMatch = report.description
        .toLowerCase()
        .includes(searchValue);
      const reporterMatch = report.reporterId
        .toLowerCase()
        .includes(searchValue);
      const assignmentMatch =
        report.assignment?.name?.toLowerCase().includes(searchValue) || false;
      const idMatch = report.id.toString().includes(searchValue);

      return descriptionMatch || reporterMatch || assignmentMatch || idMatch;
    };
  }, [startDate, endDate]);

  const table = useReactTable({
    data: reports,
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
  }, [startDate, endDate, table, globalFilter]);

  const exportToCSV = () => {
    const filteredData = table
      .getFilteredRowModel()
      .rows.map((row) => row.original);

    const headers = [
      "ID",
      "Reporter ID",
      "Assignment Name",
      "Issue Type",
      "Status",
      "Description",
      "Is Author",
      "Issue Number",
      "Status Message",
      "Resolution",
      "Comments",
      "Closure Reason",
      "Created At",
      "Updated At",
    ];

    const csvContent = [
      headers.join(","),
      ...filteredData.map((item) =>
        [
          item.id,
          item.reporterId,
          `"${item.assignment?.name || "N/A"}"`,
          item.issueType,
          item.status,
          `"${item.description}"`,
          item.author,
          item.issueNumber || "",
          `"${item.statusMessage || ""}"`,
          `"${item.resolution || ""}"`,
          `"${item.comments || ""}"`,
          `"${item.closureReason || ""}"`,
          new Date(item.createdAt).toLocaleString(),
          new Date(item.updatedAt).toLocaleString(),
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading && reports.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-muted-foreground">Loading reports...</div>
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
            <CardTitle className="text-lg">Reports Management</CardTitle>
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
                placeholder="Search reports by ID, description, reporter, or assignment..."
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
                Status Filter
              </label>
              <select
                value={
                  (table.getColumn("status")?.getFilterValue() as string) ??
                  "all"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "all") {
                    table.getColumn("status")?.setFilterValue(undefined);
                  } else {
                    table.getColumn("status")?.setFilterValue(value);
                  }
                }}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="CLOSED">Closed</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Issue Type Filter
              </label>
              <select
                value={
                  (table.getColumn("issueType")?.getFilterValue() as string) ??
                  "all"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "all") {
                    table.getColumn("issueType")?.setFilterValue(undefined);
                  } else {
                    table.getColumn("issueType")?.setFilterValue(value);
                  }
                }}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                <option value="all">All Issue Types</option>
                <option value="BUG">Bug</option>
                <option value="FEATURE_REQUEST">Feature Request</option>
                <option value="QUESTION">Question</option>
                <option value="FEEDBACK">Feedback</option>
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
            table.getColumn("status")?.getFilterValue() !== undefined ||
            table.getColumn("issueType")?.getFilterValue() !== undefined ||
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
                {table.getColumn("status")?.getFilterValue() !== undefined && (
                  <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                    Status:{" "}
                    {String(table.getColumn("status")?.getFilterValue())}
                  </span>
                )}
                {table.getColumn("issueType")?.getFilterValue() !==
                  undefined && (
                  <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                    Type:{" "}
                    {String(table.getColumn("issueType")?.getFilterValue())}
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
            <CardTitle className="flex items-center gap-2">Reports</CardTitle>
            <div className="text-sm text-muted-foreground">
              Showing {table.getFilteredRowModel().rows.length} of{" "}
              {reports.length} reports
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No reports found
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
                reports.length > 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-50 rounded-2xl mx-auto w-fit mb-4">
                      <Search className="h-8 w-8 mx-auto text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No reports match your filters
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

      <ReportModal
        report={selectedReport}
        isOpen={isReportModalOpen}
        onClose={closeReportModal}
      />
    </div>
  );
}
