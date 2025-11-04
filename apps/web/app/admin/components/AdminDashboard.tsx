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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useDashboardStats,
  useCurrentPriceUpscaling,
  useUpscalePricing,
  useRemovePriceUpscaling,
  useRefreshDashboard,
} from "@/hooks/useAdminDashboard";
import {
  Settings,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Calculator,
  RotateCcw,
  Calendar,
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
  }>({});
  const [datePreset, setDatePreset] = useState<string>("all");
  const [customDateRange, setCustomDateRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });
  const [showCustomDatePopover, setShowCustomDatePopover] = useState(false);
  const [quickActionResults, setQuickActionResults] = useState<any[] | null>(
    null,
  );
  const [quickActionTitle, setQuickActionTitle] = useState<string>("");

  const [isPriceUpscalingModalOpen, setIsPriceUpscalingModalOpen] =
    useState(false);
  const [globalUpscalingFactor, setGlobalUpscalingFactor] = useState("");
  const [usageTypeUpscaling, setUsageTypeUpscaling] = useState({
    TRANSLATION: "",
    QUESTION_GENERATION: "",
    ASSIGNMENT_GENERATION: "",
    LIVE_RECORDING_FEEDBACK: "",
    GRADING_VALIDATION: "",
    ASSIGNMENT_GRADING: "",
    OTHER: "",
  });

  const {
    data: stats,
    isLoading: loadingStats,
    error: statsError,
  } = useDashboardStats(sessionToken, filters);

  const { data: currentUpscaling, isLoading: loadingUpscaling } =
    useCurrentPriceUpscaling(sessionToken);

  const upscalePricingMutation = useUpscalePricing(sessionToken);
  const removePricingMutation = useRemovePriceUpscaling(sessionToken);
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

  const handleUsageTypeUpscalingChange = (
    usageType: keyof typeof usageTypeUpscaling,
    value: string,
  ) => {
    setUsageTypeUpscaling((prev) => ({
      ...prev,
      [usageType]: value,
    }));
  };

  const resetUpscalingModal = () => {
    setGlobalUpscalingFactor("");
    setUsageTypeUpscaling({
      TRANSLATION: "",
      QUESTION_GENERATION: "",
      ASSIGNMENT_GENERATION: "",
      LIVE_RECORDING_FEEDBACK: "",
      GRADING_VALIDATION: "",
      ASSIGNMENT_GRADING: "",
      OTHER: "",
    });
  };

  const calculatePriceExample = () => {
    const useRealData = stats && stats.costBreakdown;

    const exampleUsage = useRealData
      ? {
          TRANSLATION: {
            inputTokens: 1500,
            outputTokens: 800,
            currentCost:
              stats.costBreakdown.translation /
              Math.max(stats.publishedAssignments, 1),
          },
          QUESTION_GENERATION: {
            inputTokens: 2000,
            outputTokens: 1200,
            currentCost:
              stats.costBreakdown.questionGeneration /
              Math.max(stats.publishedAssignments, 1),
          },
          ASSIGNMENT_GENERATION: {
            inputTokens: 800,
            outputTokens: 1500,
            currentCost:
              (stats.costBreakdown.questionGeneration /
                Math.max(stats.publishedAssignments, 1)) *
              0.3,
          },
          LIVE_RECORDING_FEEDBACK: {
            inputTokens: 1200,
            outputTokens: 900,
            currentCost:
              (stats.costBreakdown.grading /
                Math.max(stats.publishedAssignments, 1)) *
              0.2,
          },
          GRADING_VALIDATION: {
            inputTokens: 600,
            outputTokens: 400,
            currentCost:
              (stats.costBreakdown.grading /
                Math.max(stats.publishedAssignments, 1)) *
              0.1,
          },
          ASSIGNMENT_GRADING: {
            inputTokens: 2200,
            outputTokens: 1800,
            currentCost:
              (stats.costBreakdown.grading /
                Math.max(stats.publishedAssignments, 1)) *
              0.7,
          },
          OTHER: {
            inputTokens: 300,
            outputTokens: 200,
            currentCost:
              stats.costBreakdown.other /
              Math.max(stats.publishedAssignments, 1),
          },
        }
      : {
          TRANSLATION: {
            inputTokens: 1500,
            outputTokens: 800,
            currentCost: 0.0085,
          },
          QUESTION_GENERATION: {
            inputTokens: 2000,
            outputTokens: 1200,
            currentCost: 0.0125,
          },
          ASSIGNMENT_GENERATION: {
            inputTokens: 800,
            outputTokens: 1500,
            currentCost: 0.0095,
          },
          LIVE_RECORDING_FEEDBACK: {
            inputTokens: 1200,
            outputTokens: 900,
            currentCost: 0.0105,
          },
          GRADING_VALIDATION: {
            inputTokens: 600,
            outputTokens: 400,
            currentCost: 0.0045,
          },
          ASSIGNMENT_GRADING: {
            inputTokens: 2200,
            outputTokens: 1800,
            currentCost: 0.0185,
          },
          OTHER: { inputTokens: 300, outputTokens: 200, currentCost: 0.0025 },
        };

    let totalCurrentCost = 0;
    let totalNewCost = 0;
    const breakdown: {
      [key: string]: { current: number; new: number; factor: number };
    } = {};

    for (const [usageType, usage] of Object.entries(exampleUsage)) {
      totalCurrentCost += usage.currentCost;

      let scalingFactor = 1;

      const globalFactor = parseFloat(globalUpscalingFactor);
      if (globalFactor && globalFactor > 0) {
        scalingFactor *= globalFactor;
      }

      const usageFactorValue =
        usageTypeUpscaling[usageType as keyof typeof usageTypeUpscaling];
      const usageFactor = parseFloat(usageFactorValue);
      if (usageFactor && usageFactor > 0) {
        scalingFactor *= usageFactor;
      }

      const newCost = usage.currentCost * scalingFactor;
      totalNewCost += newCost;

      breakdown[usageType] = {
        current: usage.currentCost,
        new: newCost,
        factor: scalingFactor,
      };
    }

    return {
      totalCurrentCost,
      totalNewCost,
      breakdown,
      percentageChange:
        totalCurrentCost > 0
          ? ((totalNewCost - totalCurrentCost) / totalCurrentCost) * 100
          : 0,
    };
  };

  const handlePriceUpscaling = async () => {
    if (!sessionToken) return;

    const globalFactor = parseFloat(globalUpscalingFactor);
    if (globalUpscalingFactor && (isNaN(globalFactor) || globalFactor <= 0)) {
      alert("Global upscaling factor must be a positive number");
      return;
    }

    const usageFactors: { [key: string]: number } = {};
    for (const [usageType, value] of Object.entries(usageTypeUpscaling)) {
      if (value.trim()) {
        const factor = parseFloat(value);
        if (isNaN(factor) || factor <= 0) {
          alert(`${usageType} upscaling factor must be a positive number`);
          return;
        }
        usageFactors[usageType] = factor;
      }
    }

    if (!globalUpscalingFactor && Object.keys(usageFactors).length === 0) {
      alert("Please enter at least one upscaling factor");
      return;
    }

    try {
      await upscalePricingMutation.mutateAsync({
        globalFactor: globalFactor || undefined,
        usageFactors:
          Object.keys(usageFactors).length > 0 ? usageFactors : undefined,
        reason: "Manual price upscaling via admin interface",
      });

      alert("Prices have been successfully upscaled!");
      setIsPriceUpscalingModalOpen(false);
      resetUpscalingModal();
    } catch (error) {
      console.error("Failed to upscale prices:", error);
      alert(
        `Failed to upscale prices: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    }
  };

  const handleRemoveUpscaling = async () => {
    if (!sessionToken) return;

    const confirmRemoval = confirm(
      "Are you sure you want to remove the current price upscaling? This will revert all pricing to base rates.",
    );
    if (!confirmRemoval) return;

    try {
      const result = await removePricingMutation.mutateAsync(
        "Manual removal via admin interface",
      );

      if (result.success) {
        alert(
          "Price upscaling has been successfully removed. All pricing reverted to base rates.",
        );
      } else {
        alert(result.message || "No active price upscaling found to remove.");
      }
    } catch (error) {
      console.error("Failed to remove upscaling:", error);
      alert(
        `Failed to remove price upscaling: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    }
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
              {currentUpscaling && (
                <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded border border-orange-200">
                  <TrendingUp className="h-3 w-3" />
                  <span>Price Upscaling Active</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveUpscaling}
                    disabled={removePricingMutation.isPending}
                    className="h-6 px-2 text-orange-600 hover:bg-orange-100"
                  >
                    {removePricingMutation.isPending ? (
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-orange-600" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              )}

              <Dialog
                open={isPriceUpscalingModalOpen}
                onOpenChange={setIsPriceUpscalingModalOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-orange-600 border-orange-200 hover:bg-orange-50"
                  >
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Upscale Prices
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-orange-600">
                      <TrendingUp className="h-5 w-5" />
                      Price Upscaling (Super Admin Only)
                    </DialogTitle>
                    <DialogDescription>
                      Apply upscaling factors to AI pricing. You can set a
                      global factor or specific factors for each usage type.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6">
                    {currentUpscaling && (
                      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-blue-800">
                            Current Active Upscaling
                          </p>
                          <div className="text-sm text-blue-700 space-y-1 mt-1">
                            {currentUpscaling.globalFactor && (
                              <div>
                                Global Factor: {currentUpscaling.globalFactor}x
                              </div>
                            )}
                            {currentUpscaling.usageTypeFactors && (
                              <div>Usage-specific factors applied</div>
                            )}
                            <div className="text-xs text-blue-600">
                              Applied:{" "}
                              {new Date(
                                currentUpscaling.effectiveDate,
                              ).toLocaleString()}
                            </div>
                            {currentUpscaling.reason && (
                              <div className="text-xs text-blue-600">
                                Reason: {currentUpscaling.reason}
                              </div>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRemoveUpscaling}
                          disabled={removePricingMutation.isPending}
                          className="text-blue-600 border-blue-200 hover:bg-blue-100"
                        >
                          {removePricingMutation.isPending ? (
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2" />
                          ) : (
                            <RotateCcw className="h-3 w-3 mr-2" />
                          )}
                          Remove
                        </Button>
                      </div>
                    )}

                    <div>
                      <Label
                        htmlFor="global-factor"
                        className="text-sm font-medium"
                      >
                        Global Upscaling Factor (optional)
                      </Label>
                      <Input
                        id="global-factor"
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="e.g., 1.2 (20% increase)"
                        value={globalUpscalingFactor}
                        onChange={(e) =>
                          setGlobalUpscalingFactor(e.target.value)
                        }
                        className="mt-1"
                      />

                      <p className="text-xs text-muted-foreground mt-1">
                        If set, this will be applied to all usage types
                        (multiplied with individual factors)
                      </p>
                    </div>

                    <div>
                      <Label className="text-sm font-medium mb-3 block">
                        Usage Type Specific Factors (optional)
                      </Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.entries(usageTypeUpscaling).map(
                          ([usageType, value]) => (
                            <div key={usageType}>
                              <Label
                                htmlFor={usageType}
                                className="text-xs text-muted-foreground"
                              >
                                {usageType
                                  .replace(/_/g, " ")
                                  .toLowerCase()
                                  .replace(/\b\w/g, (l) => l.toUpperCase())}
                              </Label>
                              <Input
                                id={usageType}
                                type="number"
                                step="0.1"
                                min="0"
                                placeholder="1.0"
                                value={value}
                                onChange={(e) =>
                                  handleUsageTypeUpscalingChange(
                                    usageType as keyof typeof usageTypeUpscaling,
                                    e.target.value,
                                  )
                                }
                                className="mt-1"
                              />
                            </div>
                          ),
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Individual factors are applied after the global factor
                        (if set)
                      </p>
                    </div>

                    {(globalUpscalingFactor ||
                      Object.values(usageTypeUpscaling).some((v) =>
                        v.trim(),
                      )) && (
                      <div className="border-t pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Calculator className="h-4 w-4 text-blue-600" />
                          <Label className="text-sm font-medium text-blue-600">
                            Price Impact Example
                          </Label>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          {(() => {
                            const example = calculatePriceExample();
                            const useRealData = stats && stats.costBreakdown;
                            return (
                              <>
                                <p className="text-xs text-blue-700 mb-3">
                                  {useRealData
                                    ? `Based on your current assignment data (average per assignment)`
                                    : `Based on a typical assignment with average AI usage`}
                                </p>
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center p-3 bg-white rounded border">
                                    <div>
                                      <div className="text-sm font-medium">
                                        Total Assignment Cost
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Current → New
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-lg font-bold">
                                        ${example.totalCurrentCost.toFixed(4)} →
                                        ${example.totalNewCost.toFixed(4)}
                                      </div>
                                      <div
                                        className={`text-xs font-medium ${example.percentageChange > 0 ? "text-red-600" : example.percentageChange < 0 ? "text-green-600" : "text-gray-600"}`}
                                      >
                                        {example.percentageChange > 0
                                          ? "+"
                                          : ""}
                                        {example.percentageChange.toFixed(1)}%
                                        change
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                                    {Object.entries(example.breakdown)
                                      .filter(([, data]) => data.factor !== 1)
                                      .map(([usageType, data]) => (
                                        <div
                                          key={usageType}
                                          className="flex justify-between items-center text-xs p-2 bg-white rounded border"
                                        >
                                          <div className="font-medium">
                                            {usageType
                                              .replace(/_/g, " ")
                                              .toLowerCase()
                                              .replace(/\b\w/g, (l) =>
                                                l.toUpperCase(),
                                              )}
                                          </div>
                                          <div className="text-right">
                                            <div>
                                              ${data.current.toFixed(4)} → $
                                              {data.new.toFixed(4)}
                                            </div>
                                            <div className="text-gray-500">
                                              ×{data.factor.toFixed(1)}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                  </div>

                                  {Object.values(example.breakdown).every(
                                    (data) => data.factor === 1,
                                  ) && (
                                    <div className="text-xs text-gray-500 text-center p-2">
                                      No changes applied with current factors
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between pt-4">
                      <Button
                        variant="outline"
                        onClick={resetUpscalingModal}
                        disabled={upscalePricingMutation.isPending}
                      >
                        Reset All
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setIsPriceUpscalingModalOpen(false)}
                          disabled={upscalePricingMutation.isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handlePriceUpscaling}
                          disabled={upscalePricingMutation.isPending}
                          className="bg-orange-600 hover:bg-orange-700"
                        >
                          {upscalePricingMutation.isPending ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                              Applying...
                            </>
                          ) : (
                            <>
                              <TrendingUp className="h-4 w-4 mr-2" />
                              Apply Upscaling
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Link href="/admin/llm-assignments">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  LLM Settings
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
