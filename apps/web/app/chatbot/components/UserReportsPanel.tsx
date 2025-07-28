"use client";
import React, { useState, useEffect } from "react";
import {
  ClockIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  ArrowLeftIcon,
  ChatBubbleBottomCenterTextIcon,
} from "@heroicons/react/24/outline";
import { getReportsForUser } from "@/lib/shared";
import { getUserNotifications } from "@/lib/author";

interface Report {
  id: string;
  issueType: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  statusMessage?: string;
  issueNumber?: string;
  resolution?: string;
  comments?: string;
}

interface UserReportsProps {
  userId: string;
  onClose: () => void;
}

type SortField = "createdAt" | "updatedAt" | "status" | "issueType";

const ITEMS_PER_CHUNK = 20;

const UserReportsPanel: React.FC<UserReportsProps> = ({ userId, onClose }) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [filteredReports, setFilteredReports] = useState<Report[]>([]);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_CHUNK);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [reportsWithNotifications, setReportsWithNotifications] = useState<
    Record<string, number>
  >({});

  // Fetch unread notifications per report
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const notifications = await getUserNotifications(userId);
        const byReport: Record<string, number> = {};
        notifications.forEach((n) => {
          if (!n.read && n.type === "ISSUE_STATUS_CHANGE") {
            try {
              const { reportId } = JSON.parse(n.metadata || "{}") as {
                reportId?: string;
                [key: string]: any;
              };
              if (reportId) byReport[reportId] = (byReport[reportId] || 0) + 1;
            } catch {
              console.error(
                "Failed to parse notification metadata",
                n.metadata,
              );
            }
          }
        });
        setReportsWithNotifications(byReport);
      } catch (e) {
        console.error(e);
      }
    };
    if (userId) void fetchNotifications();
  }, [userId]);

  // Fetch the list of reports
  const fetchReports = async () => {
    setLoading(true);
    try {
      const resp = await getReportsForUser();
      setReports(resp);
      setError(null);
    } catch (e) {
      console.error(e);
      setError("Failed to load your reports. Please try again later.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void fetchReports();
  }, [userId]);

  // Filter, search, sort
  useEffect(() => {
    let result = [...reports];

    if (statusFilter !== "ALL") {
      result = result.filter((r) => r.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          r.issueType.toLowerCase().includes(q) ||
          r.statusMessage?.toLowerCase().includes(q) ||
          r.resolution?.toLowerCase().includes(q) ||
          r.comments?.toLowerCase().includes(q),
      );
    }

    result.sort((a: Report, b: Report) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];
      if (sortField === "createdAt" || sortField === "updatedAt") {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }
      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();
      if (sortDirection === "asc") return aVal > bVal ? 1 : -1;
      else return aVal < bVal ? 1 : -1;
    });

    setFilteredReports(result);
    setVisibleCount(ITEMS_PER_CHUNK);
  }, [reports, searchQuery, statusFilter, sortField, sortDirection]);

  const refreshReports = async () => {
    setRefreshing(true);
    await fetchReports();
    setTimeout(() => setRefreshing(false), 600);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "OPEN":
        return <ClockIcon className="w-5 h-5 text-purple-500" />;
      case "IN_PROGRESS":
        return <ArrowPathIcon className="w-5 h-5 text-yellow-500" />;
      case "RESOLVED":
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case "CLOSED":
        return <XCircleIcon className="w-5 h-5 text-gray-500" />;
      default:
        return <ExclamationCircleIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "OPEN":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "IN_PROGRESS":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "RESOLVED":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "CLOSED":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  const formatTimeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const sec = Math.round(diff / 1000);
    const min = Math.round(sec / 60);
    const hr = Math.round(min / 60);
    const day = Math.round(hr / 24);
    if (sec < 60) return `${sec} second${sec !== 1 ? "s" : ""} ago`;
    if (min < 60) return `${min} minute${min !== 1 ? "s" : ""} ago`;
    if (hr < 24) return `${hr} hour${hr !== 1 ? "s" : ""} ago`;
    return `${day} day${day !== 1 ? "s" : ""} ago`;
  };

  const getStatusText = (s: string) =>
    ({
      OPEN: "Open",
      IN_PROGRESS: "In Progress",
      RESOLVED: "Resolved",
      CLOSED: "Closed",
    })[s] ?? "Unknown";

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1 inline-block">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const getIssueTruncatedDescription = (d: string) =>
    d.length > 80 ? d.slice(0, 80) + "…" : d;

  const formatComments = (c?: string) =>
    c?.split("\n\n").map((p, i) => (
      <p key={i} className="mb-3 last:mb-0">
        {p}
      </p>
    ));

  // Only render up to visibleCount
  const visibleReports = filteredReports.slice(0, visibleCount);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 max-w-4xl mx-auto h-[800px]">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">
          Your Reported Issues
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
        >
          <XCircleIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Loading / Error */}
      {loading ? (
        <div className="flex flex-col items-center p-12">
          <div className="animate-spin h-12 w-12 border-b-2 border-purple-500 rounded-full" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            Loading your reports...
          </p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 p-4 rounded-lg text-center">
          <ExclamationCircleIcon className="w-6 h-6 mx-auto mb-2" />
          <p>{error}</p>
          <button
            onClick={refreshReports}
            className="mt-3 px-4 py-2 bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700 rounded-md text-red-800 dark:text-red-200 transition"
          >
            Try Again
          </button>
        </div>
      ) : selectedReport ? (
        <div className="space-y-4 animate-fadeIn">
          <button
            onClick={() => setSelectedReport(null)}
            className="text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 flex items-center p-2 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" /> Back to all reports
          </button>

          <div className="bg-gray-50 dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-2 mb-4">
              <div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium inline-flex items-center ${getStatusClass(selectedReport.status)}`}
                >
                  {getStatusIcon(selectedReport.status)}
                  <span className="ml-1">
                    {getStatusText(selectedReport.status)}
                  </span>
                </span>
                <h3 className="font-bold text-xl mt-2 text-gray-800 dark:text-gray-200">
                  {selectedReport.issueType.charAt(0).toUpperCase() +
                    selectedReport.issueType.slice(1)}{" "}
                  Report
                  {selectedReport.issueNumber
                    ? ` #${selectedReport.issueNumber}`
                    : ""}
                </h3>
              </div>
              <div className="text-sm text-gray-500 space-y-1">
                <div>Reported: {formatDate(selectedReport.createdAt)}</div>
                <div>Updated: {formatDate(selectedReport.updatedAt)}</div>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="text-gray-600 dark:text-gray-400 font-medium mb-2">
                Description
              </h4>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {selectedReport.description}
              </div>
            </div>

            {selectedReport.statusMessage && (
              <div className="mt-6">
                <h4 className="text-gray-600 dark:text-gray-400 font-medium mb-2">
                  Status Update
                </h4>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-md border border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-200">
                  {selectedReport.statusMessage}
                </div>
              </div>
            )}

            {selectedReport.comments && (
              <div className="mt-6">
                <h4 className="text-gray-600 dark:text-gray-400 font-medium mb-2">
                  <div className="flex items-center">
                    <ChatBubbleBottomCenterTextIcon className="w-5 h-5 mr-1" />
                    Developer Comments
                  </div>
                </h4>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-md border border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-200">
                  {formatComments(selectedReport.comments)}
                </div>
              </div>
            )}

            {selectedReport.resolution && (
              <div className="mt-6">
                <h4 className="text-gray-600 dark:text-gray-400 font-medium mb-2">
                  Resolution
                </h4>
                <div className="p-4 bg-green-50 dark:bg-green-900/30 rounded-md border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200">
                  {selectedReport.resolution}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Search, filters, and scrollable chunked list */
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-grow">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search reports…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="py-2 px-3 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
            <button
              onClick={refreshReports}
              disabled={refreshing}
              className={`p-2 rounded-md border border-gray-300 dark:border-gray-600 ${
                refreshing
                  ? "bg-gray-100 dark:bg-gray-800"
                  : "bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
              } text-gray-800 dark:text-gray-200 transition`}
              aria-label="Refresh reports"
            >
              <ArrowPathIcon
                className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {filteredReports.length === 0 ? (
            <div className="text-center py-12">
              <ExclamationCircleIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              {reports.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">
                  You haven’t reported any issues yet.
                </p>
              ) : (
                <>
                  <p className="text-gray-500 dark:text-gray-400">
                    No reports match your filters.
                  </p>
                  <button
                    onClick={() => {
                      setStatusFilter("ALL");
                      setSearchQuery("");
                    }}
                    className="mt-4 px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Table headers for sort */}
              <div className="border-b border-gray-200 dark:border-gray-700 mb-3">
                <div className="flex text-xs text-gray-500 dark:text-gray-400 py-2 px-3">
                  <div className="flex-grow">
                    <button
                      onClick={() => toggleSort("issueType")}
                      className="font-medium hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Issue Type {getSortIcon("issueType")}
                    </button>
                  </div>
                  <div className="w-24 text-center">
                    <button
                      onClick={() => toggleSort("status")}
                      className="font-medium hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Status {getSortIcon("status")}
                    </button>
                  </div>
                  <div className="w-32 text-right">
                    <button
                      onClick={() => toggleSort("updatedAt")}
                      className="font-medium hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Updated {getSortIcon("updatedAt")}
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable chunked list */}
              <div className="max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
                <div className="space-y-2 p-2 animate-fadeIn">
                  {visibleReports.map((report) => (
                    <div
                      key={report.id}
                      onClick={() => setSelectedReport(report)}
                      className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(report.status)}
                          <span className="font-medium text-gray-800 dark:text-gray-200">
                            {report.issueType.charAt(0).toUpperCase() +
                              report.issueType.slice(1)}
                            {report.issueNumber
                              ? ` #${report.issueNumber}`
                              : ""}
                          </span>
                          {reportsWithNotifications[report.id] && (
                            <span className="bg-purple-500 text-white text-xs rounded-full px-2 py-0.5">
                              New
                            </span>
                          )}
                          {report.comments && (
                            <ChatBubbleBottomCenterTextIcon
                              className="w-4 h-4 text-purple-500"
                              title="Has developer comments"
                            />
                          )}
                        </div>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusClass(report.status)}`}
                        >
                          {getStatusText(report.status)}
                        </span>
                      </div>
                      <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
                        {getIssueTruncatedDescription(report.description)}
                      </p>
                      <div className="flex justify-between items-center mt-3 text-xs text-gray-500">
                        <span>#{report.id}</span>
                        <span title={formatDate(report.updatedAt)}>
                          Updated {formatTimeAgo(report.updatedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Load more */}
              {visibleCount < filteredReports.length && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => setVisibleCount((c) => c + ITEMS_PER_CHUNK)}
                    className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition"
                  >
                    Load More
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default UserReportsPanel;
