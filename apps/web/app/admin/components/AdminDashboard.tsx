"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { FeedbackTable } from "./FeedbackTable";
import { ReportsTable } from "./ReportsTable";
import { AssignmentAnalyticsTable } from "./AssignmentAnalyticsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useDashboardStats,
  useRefreshDashboard,
} from "@/hooks/useAdminDashboard";
import {
  Settings,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Activity,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Link from "next/link";
import { queryClient } from "@/lib/query-client";

const DAY_MS = 24 * 60 * 60 * 1000;

// Default dashboard window. "All time" makes getDashboardStats load every
// AIUsage row and run full-table group-bys (cost grows unbounded with history),
// so the dashboard opens on a bounded last-24h window instead.
function getLast24hRange(): { startDate: string; endDate: string } {
  const now = new Date();
  return {
    startDate: new Date(now.getTime() - DAY_MS).toISOString(),
    endDate: now.toISOString(),
  };
}

interface AdminDashboardProps {
  sessionToken?: string | null;
  onLogout?: () => void;
}

function AdminDashboardContent({
  sessionToken,
  onLogout,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<
    "feedback" | "reports" | "assignments"
  >("assignments");
  const [filters, setFilters] = useState<{
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  }>(() => getLast24hRange());
  const [datePreset, setDatePreset] = useState<string>("last24hours");
  const [customDateRange, setCustomDateRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });
  const [showCustomDatePopover, setShowCustomDatePopover] = useState(false);
  const [quickActionResults, setQuickActionResults] = useState<any[] | null>(
    null,
  );
  const [quickActionTitle, setQuickActionTitle] = useState<string>("");

  const {
    data: stats,
    isLoading: loadingStats,
    error: statsError,
  } = useDashboardStats(sessionToken, filters);

  const refreshDashboard = useRefreshDashboard(sessionToken);

  const handleFiltersChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
  };

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const newFilters = { ...filters };

    switch (preset) {
      case "last24hours": {
        const range = getLast24hRange();
        newFilters.startDate = range.startDate;
        newFilters.endDate = range.endDate;
        break;
      }
      case "today": {
        newFilters.startDate = today.toISOString();
        newFilters.endDate = new Date(
          today.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
        break;
      }
      case "yesterday": {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        newFilters.startDate = yesterday.toISOString();
        newFilters.endDate = today.toISOString();
        break;
      }
      case "last7days": {
        newFilters.startDate = new Date(
          today.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        newFilters.endDate = new Date(
          today.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
        break;
      }
      case "last30days": {
        newFilters.startDate = new Date(
          today.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        newFilters.endDate = new Date(
          today.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
        break;
      }
      case "thisMonth": {
        newFilters.startDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
        ).toISOString();
        newFilters.endDate = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59,
        ).toISOString();
        break;
      }
      case "lastMonth": {
        newFilters.startDate = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          1,
        ).toISOString();
        newFilters.endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          0,
          23,
          59,
          59,
        ).toISOString();
        break;
      }
      case "custom": {
        setShowCustomDatePopover(true);
        return;
      }
      case "all": {
        break;
      }
      default: {
        delete newFilters.startDate;
        delete newFilters.endDate;
        break;
      }
    }

    setFilters(newFilters);
  };

  const handleCustomDateApply = () => {
    if (customDateRange.start && customDateRange.end) {
      setFilters({
        ...filters,
        startDate: new Date(customDateRange.start).toISOString(),
        endDate: new Date(customDateRange.end).toISOString(),
      });
      setShowCustomDatePopover(false);
    }
  };

  const formatDateRange = () => {
    if (!filters.startDate || !filters.endDate) return "All time";

    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);

    if (datePreset === "last24hours") return "Last 24 hours";
    if (datePreset === "today") return "Today";
    if (datePreset === "yesterday") return "Yesterday";
    if (datePreset === "last7days") return "Last 7 days";
    if (datePreset === "last30days") return "Last 30 days";
    if (datePreset === "thisMonth") return "This month";
    if (datePreset === "lastMonth") return "Last month";

    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  };

  const handleQuickActionComplete = (result: any) => {
    setQuickActionResults(result.data);
    setQuickActionTitle(result.title);
    setActiveTab("assignments");
  };

  const handleRefresh = () => {
    refreshDashboard();
  };

  const isAdmin = stats?.userRole === "admin";

  const clearQuickActionResults = () => {
    setQuickActionResults(null);
    setQuickActionTitle("");
  };

  if (statsError) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Error Loading Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700 text-sm">
              {statsError instanceof Error
                ? statsError.message
                : "Failed to load dashboard data"}
            </p>
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {isAdmin ? "Admin Dashboard" : "Author Dashboard"}
            </h1>
            {stats && (
              <Badge variant={isAdmin ? "default" : "secondary"}>
                {isAdmin ? "Super Admin" : "Author"}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Manage all assignments, feedback and reports"
              : "Manage your assignments and feedback"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={loadingStats}
            size="sm"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loadingStats ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          {isAdmin && (
            <>
              <Link href="/admin/llm-assignments">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  LLM Settings
                </Button>
              </Link>

              <Link href="/admin/queues">
                <Button variant="outline" size="sm">
                  <Activity className="h-4 w-4 mr-2" />
                  Queues
                </Button>
              </Link>
            </>
          )}
          {onLogout && (
            <Button variant="outline" onClick={onLogout} size="sm">
              Logout
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={datePreset} onValueChange={handleDatePresetChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue>{formatDateRange()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last24hours">Last 24 hours</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7days">Last 7 days</SelectItem>
                <SelectItem value="last30days">Last 30 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="lastMonth">Last month</SelectItem>
                <SelectItem value="custom">Custom range...</SelectItem>
              </SelectContent>
            </Select>

            <Popover
              open={showCustomDatePopover}
              onOpenChange={setShowCustomDatePopover}
            >
              <PopoverTrigger asChild>
                <span />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={customDateRange.start}
                      onChange={(e) =>
                        setCustomDateRange({
                          ...customDateRange,
                          start: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end-date">End Date</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={customDateRange.end}
                      onChange={(e) =>
                        setCustomDateRange({
                          ...customDateRange,
                          end: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomDatePopover(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCustomDateApply}
                      disabled={!customDateRange.start || !customDateRange.end}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {filters.startDate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters({
                  ...filters,
                  startDate: undefined,
                  endDate: undefined,
                });
                setDatePreset("all");
              }}
            >
              Clear filter
            </Button>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          {stats && filters.startDate && (
            <span>Showing data from {formatDateRange()}</span>
          )}
        </div>
      </div>

      {loadingStats ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-3 text-muted-foreground">
            Loading dashboard data...
          </span>
        </div>
      ) : stats ? (
        <>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${isAdmin ? "lg:grid-cols-4 xl:grid-cols-5" : "lg:grid-cols-5"} gap-6`}
          >
            <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-blue-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  Assignments Created
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-none">
                  {stats.totalAssignments.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Total created
                </p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-green-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Assignments Published
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent leading-none">
                  {stats.publishedAssignments.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Currently active
                </p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-indigo-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                  Total Unique Learners
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent leading-none">
                  {stats.totalLearners.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Registered users
                </p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-yellow-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                  Avg Rating
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-bold bg-gradient-to-r from-yellow-600 to-orange-600 bg-clip-text text-transparent leading-none">
                  {stats.averageAssignmentRating?.toFixed(1) || "0.0"}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Out of 5 stars
                </p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-emerald-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  AI Cost
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent leading-none">
                  ${stats.totalCost.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {filters.startDate ? formatDateRange() : "Total spent"}
                </p>
              </CardContent>
            </Card>

            {isAdmin && (
              <>
                <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-red-300">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      Total Reports
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-3xl font-bold text-gray-900 leading-none">
                      {stats.totalReports.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      All reports
                    </p>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-orange-300">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                      <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                      Open Reports
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-3xl font-bold text-orange-600 leading-none">
                      {stats.openReports.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Need attention
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-gray-50 border-b">
              <CardTitle className="flex items-center gap-2 text-xl">
                <div className="w-3 h-3 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full"></div>
                AI Cost Breakdown
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {filters.startDate
                  ? `Cost distribution for ${formatDateRange()}`
                  : "Cost distribution across different AI services"}
              </p>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">
                    Grading
                  </div>
                  <div className="text-lg font-semibold">
                    ${stats.costBreakdown.grading.toFixed(2)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">
                    Question Gen
                  </div>
                  <div className="text-lg font-semibold">
                    ${stats.costBreakdown.questionGeneration.toFixed(2)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">
                    Translation
                  </div>
                  <div className="text-lg font-semibold">
                    ${stats.costBreakdown.translation.toFixed(2)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">
                    Other
                  </div>
                  <div className="text-lg font-semibold">
                    ${stats.costBreakdown.other.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center text-muted-foreground py-8">
          No data available
        </div>
      )}

      <div className="border-b">
        <div className="flex items-center justify-between mb-4">
          <nav className="flex space-x-8">
            <Button
              variant="ghost"
              onClick={() => setActiveTab("assignments")}
              className={cn(
                "px-0 py-2 border-b-2 border-transparent hover:border-border rounded-none",
                activeTab === "assignments" && "border-primary text-primary",
              )}
            >
              {isAdmin ? "All Assignments" : "My Assignments"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setActiveTab("feedback")}
              className={cn(
                "px-0 py-2 border-b-2 border-transparent hover:border-border rounded-none",
                activeTab === "feedback" && "border-primary text-primary",
              )}
            >
              Feedback
            </Button>

            {isAdmin && (
              <Button
                variant="ghost"
                onClick={() => setActiveTab("reports")}
                className={cn(
                  "px-0 py-2 border-b-2 border-transparent hover:border-border rounded-none",
                  activeTab === "reports" && "border-primary text-primary",
                )}
              >
                Reports
              </Button>
            )}
          </nav>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {activeTab === "assignments" && (
            <AssignmentAnalyticsTable
              sessionToken={sessionToken}
              isAdmin={isAdmin}
              quickActionResults={quickActionResults}
              quickActionTitle={quickActionTitle}
              onClearQuickActionResults={clearQuickActionResults}
              onQuickActionComplete={handleQuickActionComplete}
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
          )}
          {activeTab === "feedback" && (
            <FeedbackTable sessionToken={sessionToken} />
          )}

          {activeTab === "reports" && isAdmin && (
            <ReportsTable sessionToken={sessionToken} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function OptimizedAdminDashboard(props: AdminDashboardProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminDashboardContent {...props} />
    </QueryClientProvider>
  );
}
