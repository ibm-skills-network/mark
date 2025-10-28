"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Users,
  FileText,
  DollarSign,
  Star,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  getCurrentAdminUser,
  getDetailedAssignmentInsights,
} from "@/lib/shared";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { ReportModal } from "@/components/modals/ReportModal";
import { formatPricePerMillionTokens } from "@/config/constants";

interface DetailedInsightData {
  assignment: {
    id: number;
    name: string;
    type: string;
    published: boolean;
    introduction?: string;
    instructions?: string;
    timeEstimateMinutes?: number;
    allotedTimeMinutes?: number;
    passingGrade?: number;
    createdAt: string;
    updatedAt: string;
    totalPoints: number;
  };
  analytics: {
    totalCost: number;
    uniqueLearners: number;
    totalAttempts: number;
    completedAttempts: number;
    averageGrade: number;
    averageRating: number;
    costBreakdown: {
      grading: number;
      questionGeneration: number;
      translation: number;
      other: number;
    };
    performanceInsights: string[];
  };
  questions: Array<{
    id: number;
    question: string;
    type: string;
    totalPoints: number;
    correctPercentage: number;
    averagePoints: number;
    responseCount: number;
    insight: string;
    variants: number;
    translations: Array<{ languageCode: string }>;
  }>;
  attempts: Array<{
    id: number;
    userId: string;
    submitted: boolean;
    grade: number | null;
    createdAt: string;
    timeSpent?: number;
    completionRate: number;
  }>;
  feedback: Array<{
    id: number;
    userId: string;
    assignmentRating: number | null;
    aiGradingRating: number | null;
    aiFeedbackRating: number | null;
    comments: string | null;
    createdAt: string;
  }>;
  reports: Array<{
    id: number;
    issueType: string;
    description: string;
    status: string;
    createdAt: string;
  }>;
  aiUsage: Array<{
    usageType: string;
    tokensIn: number;
    tokensOut: number;
    usageCount: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    modelUsed: string;
    inputTokenPrice: number;
    outputTokenPrice: number;
    pricingEffectiveDate: string;
    calculationSteps: {
      inputCalculation: string;
      outputCalculation: string;
      totalCalculation: string;
    };
    createdAt: string;
  }>;
  costCalculationDetails?: {
    totalCost: number;
    breakdown: Array<{
      usageType: string;
      tokensIn: number;
      tokensOut: number;
      modelUsed: string;
      inputTokenPrice: number;
      outputTokenPrice: number;
      inputCost: number;
      outputCost: number;
      totalCost: number;
      pricingEffectiveDate: string;
      usageDate: string;
      calculationSteps: {
        inputCalculation: string;
        outputCalculation: string;
        totalCalculation: string;
      };
    }>;
    summary: {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalInputCost: number;
      totalOutputCost: number;
      averageInputPrice: number;
      averageOutputPrice: number;
      modelDistribution: Record<string, number>;
      usageTypeDistribution: {
        grading: number;
        questionGeneration: number;
        translation: number;
        other: number;
      };
    };
  };
  authorActivity?: {
    totalAuthors: number;
    authors: Array<{
      userId: string;
      totalAssignments: number;
      totalQuestions: number;
      totalAttempts: number;
      totalAIUsage: number;
      totalFeedback: number;
      averageAttemptsPerAssignment: number;
      averageQuestionsPerAssignment: number;
      recentActivityCount: number;
      joinedAt: string;
      isActiveContributor: boolean;
      activityScore: number;
    }>;
    activityInsights: string[];
  };
}

export default function AssignmentInsightsPage() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params?.id as string;
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [data, setData] = useState<DetailedInsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [showDetailedUsage, setShowDetailedUsage] = useState(false);

  // Attempts filtering state
  const [attemptSearch, setAttemptSearch] = useState("");
  const [attemptStatusFilter, setAttemptStatusFilter] = useState("all");
  const [attemptGradeFilter, setAttemptGradeFilter] = useState("all");
  const [attemptSortBy, setAttemptSortBy] = useState("createdAt");
  const [attemptSortOrder, setAttemptSortOrder] = useState("desc");

  // Modal states
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!assignmentId) return;

      const sessionToken = localStorage.getItem("adminSessionToken");

      if (!sessionToken) {
        router.push(
          `/admin?returnTo=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }

      try {
        const user = await getCurrentAdminUser(sessionToken);
        setIsUserAdmin(user.isAdmin);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch user");
      }

      try {
        setLoading(true);
        const response = await getDetailedAssignmentInsights(
          sessionToken,
          parseInt(assignmentId),
        );
        setData(response);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch insights",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [assignmentId, router]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Modal handlers
  const openFeedbackModal = (feedback: any) => {
    setSelectedFeedback(feedback);
    setIsFeedbackModalOpen(true);
  };

  const closeFeedbackModal = () => {
    setIsFeedbackModalOpen(false);
    setSelectedFeedback(null);
  };

  const openReportModal = (report: any) => {
    setSelectedReport(report);
    setIsReportModalOpen(true);
  };

  const closeReportModal = () => {
    setIsReportModalOpen(false);
    setSelectedReport(null);
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return "N/A";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  // Filter and sort attempts
  const getFilteredAndSortedAttempts = () => {
    if (!data?.attempts) return [];

    const filtered = data.attempts.filter((attempt) => {
      // Search filter
      const searchMatch =
        attemptSearch === "" ||
        attempt.userId.toLowerCase().includes(attemptSearch.toLowerCase());

      // Status filter
      const statusMatch =
        attemptStatusFilter === "all" ||
        (attemptStatusFilter === "submitted" && attempt.submitted) ||
        (attemptStatusFilter === "in-progress" && !attempt.submitted);

      // Grade filter
      const gradeMatch =
        attemptGradeFilter === "all" ||
        (attemptGradeFilter === "passed" &&
          attempt.grade !== null &&
          attempt.grade >= 0.6) ||
        (attemptGradeFilter === "failed" &&
          attempt.grade !== null &&
          attempt.grade < 0.6) ||
        (attemptGradeFilter === "ungraded" && attempt.grade === null);

      return searchMatch && statusMatch && gradeMatch;
    });

    // Sort attempts
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (attemptSortBy) {
        case "userId":
          aValue = a.userId.toLowerCase();
          bValue = b.userId.toLowerCase();
          break;
        case "grade":
          aValue = a.grade ?? -1;
          bValue = b.grade ?? -1;
          break;
        case "timeSpent":
          aValue = a.timeSpent ?? 0;
          bValue = b.timeSpent ?? 0;
          break;
        case "createdAt":
        default:
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
      }

      if (attemptSortOrder === "asc") {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });

    return filtered;
  };

  const filteredAttempts = getFilteredAndSortedAttempts();

  const clearAttemptFilters = () => {
    setAttemptSearch("");
    setAttemptStatusFilter("all");
    setAttemptGradeFilter("all");
    setAttemptSortBy("createdAt");
    setAttemptSortOrder("desc");
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">
            Loading detailed insights...
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const isAuthError =
      error?.includes("Invalid or expired admin session") ||
      error?.includes("authentication") ||
      error?.includes("Unauthorized");

    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="text-red-600">Error: {error || "No data found"}</div>
          {isAuthError && (
            <Button
              onClick={() =>
                router.push(
                  `/admin?returnTo=${encodeURIComponent(window.location.pathname)}`,
                )
              }
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Go to Admin Login
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{data.assignment.name}</h1>
            <Badge
              variant={data.assignment.published ? "default" : "secondary"}
            >
              {data.assignment.published ? "Published" : "Draft"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Assignment ID: {data.assignment.id}
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Cost</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(data.analytics.totalCost)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Authors</p>
                <p className="text-2xl font-bold">
                  {data.authorActivity?.totalAuthors || 0}
                </p>
              </div>
              <FileText className="h-8 w-8 text-indigo-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Learners</p>
                <p className="text-2xl font-bold">
                  {data.analytics.uniqueLearners}
                </p>
              </div>
              <Users className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completion Rate</p>
                <p className="text-2xl font-bold">
                  {data.analytics.totalAttempts > 0
                    ? `${Math.round((data.analytics.completedAttempts / data.analytics.totalAttempts) * 100)}%`
                    : "N/A"}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Grade</p>
                <p className="text-2xl font-bold">
                  {data.analytics.averageGrade > 0
                    ? `${data.analytics.averageGrade.toFixed(2)}%`
                    : "N/A"}
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rating</p>
                <p className="text-2xl font-bold">
                  {data.analytics.averageRating > 0
                    ? data.analytics.averageRating.toFixed(1)
                    : "N/A"}
                </p>
              </div>
              <Star className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList
          className={`
        grid w-full ${isUserAdmin ? "grid-cols-7" : "grid-cols-6"} border-b mb-4
        `}
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authors">Authors</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="attempts">Attempts</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="ai-usage">AI Usage</TabsTrigger>
          {isUserAdmin && <TabsTrigger value="reports">Reports</TabsTrigger>}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assignment Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Assignment Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Type</p>
                  <p className="text-sm text-muted-foreground">
                    {data.assignment.type}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Time Estimate</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDuration(data.assignment.timeEstimateMinutes)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Allotted Time</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDuration(data.assignment.allotedTimeMinutes)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Passing Grade</p>
                  <p className="text-sm text-muted-foreground">
                    {data.assignment.passingGrade}%
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Total Points</p>
                  <p className="text-sm text-muted-foreground">
                    {data.assignment.totalPoints}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Created</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(data.assignment.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Last Updated</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(data.assignment.updatedAt)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Cost Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                  Cost Analysis Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Cost per Attempt */}
                  <div className="text-center">
                    <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mx-auto mb-3">
                      <TrendingUp className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="text-sm text-muted-foreground mb-2">
                      Cost per Attempt
                    </div>
                    <div className="text-2xl font-bold text-blue-700">
                      {data.analytics.totalAttempts > 0
                        ? formatCurrency(
                            data.analytics.totalCost /
                              data.analytics.totalAttempts,
                          )
                        : "N/A"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {data.analytics.totalAttempts} total attempts
                    </div>
                  </div>

                  {/* Authoring Costs */}
                  <div className="text-center">
                    <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mx-auto mb-3">
                      <FileText className="h-6 w-6 text-green-600" />
                    </div>
                    <div className="text-sm text-muted-foreground mb-2">
                      Authoring Costs
                    </div>
                    <div className="text-2xl font-bold text-green-700">
                      {formatCurrency(
                        data.aiUsage
                          .filter((usage) =>
                            [
                              "TRANSLATION",
                              "QUESTION_GENERATION",
                              "ASSIGNMENT_GENERATION",
                            ].includes(usage.usageType),
                          )
                          .reduce(
                            (sum, usage) => sum + (usage.totalCost || 0),
                            0,
                          ),
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Content creation & translation
                    </div>
                  </div>

                  {/* Learner Grading Costs */}
                  <div className="text-center">
                    <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-full mx-auto mb-3">
                      <Users className="h-6 w-6 text-purple-600" />
                    </div>
                    <div className="text-sm text-muted-foreground mb-2">
                      Grading Costs
                    </div>
                    <div className="text-2xl font-bold text-purple-700">
                      {formatCurrency(
                        data.aiUsage
                          .filter((usage) =>
                            [
                              "LIVE_RECORDING_FEEDBACK",
                              "GRADING_VALIDATION",
                              "ASSIGNMENT_GRADING",
                            ].includes(usage.usageType),
                          )
                          .reduce(
                            (sum, usage) => sum + (usage.totalCost || 0),
                            0,
                          ),
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Student feedback & validation
                    </div>
                  </div>
                </div>

                {/* Detailed Breakdown */}
                <div className="mt-6 pt-6 border-t">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Authoring Breakdown */}
                    <div>
                      <h4 className="font-semibold text-sm mb-3 text-green-700">
                        Authoring Details
                      </h4>
                      <div className="space-y-2">
                        {data.aiUsage
                          .filter((usage) =>
                            [
                              "TRANSLATION",
                              "QUESTION_GENERATION",
                              "ASSIGNMENT_GENERATION",
                            ].includes(usage.usageType),
                          )
                          .map((usage, index) => (
                            <div
                              key={index}
                              className="flex justify-between items-center py-1"
                            >
                              <span className="text-xs text-muted-foreground">
                                {usage.usageType
                                  .replace("_", " ")
                                  .toLowerCase()
                                  .replace(/\b\w/g, (l) => l.toUpperCase())}
                              </span>
                              <span className="text-sm font-mono">
                                {formatCurrency(usage.totalCost || 0)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Grading Breakdown */}
                    <div>
                      <h4 className="font-semibold text-sm mb-3 text-purple-700">
                        Grading Details
                      </h4>
                      <div className="space-y-2">
                        {data.aiUsage
                          .filter((usage) =>
                            [
                              "LIVE_RECORDING_FEEDBACK",
                              "GRADING_VALIDATION",
                              "ASSIGNMENT_GRADING",
                            ].includes(usage.usageType),
                          )
                          .map((usage, index) => (
                            <div
                              key={index}
                              className="flex justify-between items-center py-1"
                            >
                              <span className="text-xs text-muted-foreground">
                                {usage.usageType
                                  .replace("_", " ")
                                  .toLowerCase()
                                  .replace(/\b\w/g, (l) => l.toUpperCase())}
                              </span>
                              <span className="text-sm font-mono">
                                {formatCurrency(usage.totalCost || 0)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Performance Insights */}
          {data.analytics.performanceInsights.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Performance Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.analytics.performanceInsights.map((insight, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{insight}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Authors Tab */}
        <TabsContent value="authors" className="space-y-6">
          {data.authorActivity && data.authorActivity.totalAuthors > 0 ? (
            <div className="space-y-6">
              {/* Author Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Authors
                        </p>
                        <p className="text-2xl font-bold">
                          {data.authorActivity.totalAuthors}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {
                            data.authorActivity.authors.filter(
                              (a) => a.isActiveContributor,
                            ).length
                          }{" "}
                          active contributors
                        </p>
                      </div>
                      <Users className="h-8 w-8 text-indigo-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Most Active
                        </p>
                        <p className="text-lg font-bold text-truncate">
                          {data.authorActivity.authors[0]?.userId || "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {data.authorActivity.authors[0]?.totalAssignments ||
                            0}{" "}
                          assignments
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Assignments
                        </p>
                        <p className="text-2xl font-bold">
                          {data.authorActivity.authors.reduce(
                            (sum, a) => sum + a.totalAssignments,
                            0,
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          by all authors combined
                        </p>
                      </div>
                      <BarChart3 className="h-8 w-8 text-purple-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Activity Insights */}
              {data.authorActivity.activityInsights.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      Author Activity Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {data.authorActivity.activityInsights.map(
                        (insight, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{insight}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Detailed Authors Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Author Activity Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Author</TableHead>
                        <TableHead className="text-center">
                          Activity Score
                        </TableHead>
                        <TableHead className="text-center">
                          Assignments
                        </TableHead>
                        <TableHead className="text-center">
                          Questions published
                        </TableHead>
                        <TableHead className="text-center">AI Usage</TableHead>
                        <TableHead className="text-center">Feedback</TableHead>
                        <TableHead className="text-center">Joined</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.authorActivity.authors.map((author) => (
                        <TableRow key={author.userId}>
                          <TableCell className="font-mono text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                                <span className="text-xs font-semibold text-indigo-600">
                                  {author.userId
                                    .split("@")[0]
                                    ?.substring(0, 2)
                                    .toUpperCase() || "AU"}
                                </span>
                              </div>
                              <div>
                                <div className="font-medium">
                                  {author.userId.split("@")[0]}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {author.userId.split("@")[1]}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                author.activityScore > 10
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {author.activityScore}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {author.totalAssignments}
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {author.totalQuestions}
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {author.totalAIUsage > 1000
                              ? "Ridiculous Usage!"
                              : author.totalAIUsage > 500
                                ? "Very High Usage"
                                : author.totalAIUsage > 100
                                  ? "High Usage"
                                  : author.totalAIUsage > 50
                                    ? "Moderate Usage"
                                    : author.totalAIUsage > 0
                                      ? "Low Usage"
                                      : "No Usage"}
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {author.totalFeedback}
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {formatDate(author.joinedAt)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                author.isActiveContributor
                                  ? "default"
                                  : "outline"
                              }
                            >
                              {author.isActiveContributor
                                ? "Active"
                                : "Occasional"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="text-center text-muted-foreground py-8">
                  No author information available for this assignment
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Questions Tab */}
        <TabsContent value="questions">
          <Card>
            <CardHeader>
              <CardTitle>Question Performance Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-center">Points</TableHead>
                    <TableHead className="text-center">Pass Rate %</TableHead>
                    <TableHead className="text-center">Avg Points</TableHead>
                    <TableHead className="text-center">Responses</TableHead>
                    <TableHead className="text-center">Variants</TableHead>
                    <TableHead className="text-center">Languages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.questions.map((question) => (
                    <TableRow key={question.id}>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={question.question}>
                          {question.question}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {question.insight}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{question.type}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {question.totalPoints}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            question.correctPercentage < 50
                              ? "destructive"
                              : "default"
                          }
                        >
                          {Math.round(question.correctPercentage)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {question.averagePoints.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center">
                        {question.responseCount}
                      </TableCell>
                      <TableCell className="text-center">
                        {question.variants}
                      </TableCell>
                      <TableCell className="text-center">
                        {question.translations.length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attempts Tab */}
        <TabsContent value="attempts" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Assignment Attempts</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {filteredAttempts.length} of {data.attempts.length} attempts
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={clearAttemptFilters}
                  disabled={
                    attemptSearch === "" &&
                    attemptStatusFilter === "all" &&
                    attemptGradeFilter === "all"
                  }
                  className="flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Clear Filters
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search and Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search by user ID..."
                    value={attemptSearch}
                    onChange={(e) => setAttemptSearch(e.target.value)}
                    className="pl-9"
                  />
                  {attemptSearch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAttemptSearch("")}
                      className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* Status Filter */}
                <Select
                  value={attemptStatusFilter}
                  onValueChange={setAttemptStatusFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                  </SelectContent>
                </Select>

                {/* Grade Filter */}
                <Select
                  value={attemptGradeFilter}
                  onValueChange={setAttemptGradeFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by grade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Grades</SelectItem>
                    <SelectItem value="passed">Passed (≥60%)</SelectItem>
                    <SelectItem value="failed">Failed (&lt;60%)</SelectItem>
                    <SelectItem value="ungraded">Ungraded</SelectItem>
                  </SelectContent>
                </Select>

                {/* Sort */}
                <div className="flex gap-2">
                  <Select
                    value={attemptSortBy}
                    onValueChange={setAttemptSortBy}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="createdAt">Date Started</SelectItem>
                      <SelectItem value="userId">User ID</SelectItem>
                      <SelectItem value="grade">Grade</SelectItem>
                      <SelectItem value="timeSpent">Time Spent</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setAttemptSortOrder(
                        attemptSortOrder === "asc" ? "desc" : "asc",
                      )
                    }
                    className="flex items-center gap-1"
                  >
                    {attemptSortOrder === "asc" ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {filteredAttempts.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total Shown
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {filteredAttempts.filter((a) => a.submitted).length}
                  </div>
                  <div className="text-sm text-muted-foreground">Submitted</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {filteredAttempts.filter((a) => !a.submitted).length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    In Progress
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {
                      filteredAttempts.filter(
                        (a) => a.grade !== null && a.grade >= 0.6,
                      ).length
                    }
                  </div>
                  <div className="text-sm text-muted-foreground">Passed</div>
                </div>
              </div>

              {/* Table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer"
                      onClick={() => setAttemptSortBy("userId")}
                    >
                      <div className="flex items-center gap-1">
                        User ID
                        {attemptSortBy === "userId" &&
                          (attemptSortOrder === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead
                      className="text-center cursor-pointer"
                      onClick={() => setAttemptSortBy("grade")}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Grade
                        {attemptSortBy === "grade" &&
                          (attemptSortOrder === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer"
                      onClick={() => setAttemptSortBy("createdAt")}
                    >
                      <div className="flex items-center gap-1">
                        Started
                        {attemptSortBy === "createdAt" &&
                          (attemptSortOrder === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer"
                      onClick={() => setAttemptSortBy("timeSpent")}
                    >
                      <div className="flex items-center gap-1">
                        Time Spent
                        {attemptSortBy === "timeSpent" &&
                          (attemptSortOrder === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttempts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No attempts match the current filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAttempts.map((attempt) => (
                      <TableRow key={attempt.id}>
                        <TableCell className="font-mono text-xs">
                          {attempt.userId}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              attempt.submitted ? "default" : "secondary"
                            }
                          >
                            {attempt.submitted ? "Submitted" : "In Progress"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {attempt.grade !== null ? (
                            <span
                              className={
                                attempt.grade >= 0.6
                                  ? "text-green-600 font-semibold"
                                  : "text-red-600 font-semibold"
                              }
                            >
                              {Math.round(attempt.grade * 100)}%
                            </span>
                          ) : (
                            "N/A"
                          )}
                        </TableCell>
                        <TableCell>{formatDate(attempt.createdAt)}</TableCell>
                        <TableCell>
                          {attempt.timeSpent !== null &&
                          attempt.timeSpent !== undefined
                            ? formatDuration(attempt.timeSpent)
                            : "N/A"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle>User Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {data.feedback.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No feedback received yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-center">
                        Assignment Rating
                      </TableHead>
                      <TableHead className="text-center">AI Grading</TableHead>
                      <TableHead className="text-center">AI Feedback</TableHead>
                      <TableHead>Comments</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.feedback.map((feedback) => (
                      <TableRow key={feedback.id}>
                        <TableCell className="font-mono text-xs">
                          {feedback.userId}
                        </TableCell>
                        <TableCell className="text-center">
                          {feedback.assignmentRating ? (
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 text-yellow-500 fill-current" />
                              {feedback.assignmentRating}
                            </div>
                          ) : (
                            "N/A"
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {feedback.aiGradingRating ? (
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 text-yellow-500 fill-current" />
                              {feedback.aiGradingRating}
                            </div>
                          ) : (
                            "N/A"
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {feedback.aiFeedbackRating ? (
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 text-yellow-500 fill-current" />
                              {feedback.aiFeedbackRating}
                            </div>
                          ) : (
                            "N/A"
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div
                            className="truncate"
                            title={feedback.comments || ""}
                          >
                            {feedback.comments || "No comments"}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(feedback.createdAt)}</TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openFeedbackModal(feedback)}
                          >
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Usage Tab */}
        <TabsContent value="ai-usage" className="space-y-6">
          {/* Cost Category Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Authoring Costs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <FileText className="h-5 w-5" />
                  Authoring Costs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-700 mb-4">
                  {formatCurrency(
                    data.aiUsage
                      .filter((usage) =>
                        [
                          "TRANSLATION",
                          "QUESTION_GENERATION",
                          "ASSIGNMENT_GENERATION",
                        ].includes(usage.usageType),
                      )
                      .reduce((sum, usage) => sum + (usage.totalCost || 0), 0),
                  )}
                </div>
                <div className="space-y-2">
                  {data.aiUsage
                    .filter((usage) =>
                      [
                        "TRANSLATION",
                        "QUESTION_GENERATION",
                        "ASSIGNMENT_GENERATION",
                      ].includes(usage.usageType),
                    )
                    .map((usage, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center"
                      >
                        <span className="text-sm text-muted-foreground">
                          {usage.usageType
                            .replace("_", " ")
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                        <span className="font-mono text-sm">
                          {formatCurrency(usage.totalCost || 0)}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Grading Costs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-700">
                  <Users className="h-5 w-5" />
                  Grading Costs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-purple-700 mb-4">
                  {formatCurrency(
                    data.aiUsage
                      .filter((usage) =>
                        [
                          "LIVE_RECORDING_FEEDBACK",
                          "GRADING_VALIDATION",
                          "ASSIGNMENT_GRADING",
                        ].includes(usage.usageType),
                      )
                      .reduce((sum, usage) => sum + (usage.totalCost || 0), 0),
                  )}
                </div>
                <div className="space-y-2">
                  {data.aiUsage
                    .filter((usage) =>
                      [
                        "LIVE_RECORDING_FEEDBACK",
                        "GRADING_VALIDATION",
                        "ASSIGNMENT_GRADING",
                      ].includes(usage.usageType),
                    )
                    .map((usage, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center"
                      >
                        <span className="text-sm text-muted-foreground">
                          {usage.usageType
                            .replace("_", " ")
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                        <span className="font-mono text-sm">
                          {formatCurrency(usage.totalCost || 0)}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AI Usage Table */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>AI Usage Details</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Detailed breakdown of AI usage by type and model
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowDetailedUsage(!showDetailedUsage)}
                  className="flex items-center gap-2"
                >
                  {showDetailedUsage ? "Hide Details" : "Show Details"}
                  {showDetailedUsage ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usage Type</TableHead>
                    <TableHead>Model Used</TableHead>
                    <TableHead className="text-center">Total Cost</TableHead>
                    {showDetailedUsage && (
                      <>
                        <TableHead className="text-center">Tokens In</TableHead>
                        <TableHead className="text-center">
                          Tokens Out
                        </TableHead>
                        <TableHead className="text-center">
                          Input Cost
                        </TableHead>
                        <TableHead className="text-center">
                          Output Cost
                        </TableHead>
                        <TableHead>Last Used On</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.aiUsage.map((usage, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            [
                              "TRANSLATION",
                              "QUESTION_GENERATION",
                              "ASSIGNMENT_GENERATION",
                            ].includes(usage.usageType)
                              ? "border-green-300 text-green-700"
                              : [
                                    "LIVE_RECORDING_FEEDBACK",
                                    "GRADING_VALIDATION",
                                    "ASSIGNMENT_GRADING",
                                  ].includes(usage.usageType)
                                ? "border-purple-300 text-purple-700"
                                : ""
                          }
                        >
                          {usage.usageType.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="secondary">{usage.modelUsed}</Badge>
                          {showDetailedUsage && (
                            <div className="text-xs text-muted-foreground">
                              In:{" "}
                              {formatPricePerMillionTokens(
                                usage.inputTokenPrice,
                              )}
                              /1M | Out:{" "}
                              {formatPricePerMillionTokens(
                                usage.outputTokenPrice,
                              )}
                              /1M
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono font-semibold text-green-600">
                        {formatCurrency(usage.totalCost)}
                      </TableCell>
                      {showDetailedUsage && (
                        <>
                          <TableCell className="text-center font-mono">
                            {usage.tokensIn.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {usage.tokensOut.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center font-mono text-blue-600">
                            {formatCurrency(usage.inputCost)}
                          </TableCell>
                          <TableCell className="text-center font-mono text-purple-600">
                            {formatCurrency(usage.outputCost)}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div>{formatDate(usage.createdAt)}</div>
                              <div className="text-xs text-muted-foreground">
                                Pricing:{" "}
                                {formatDate(usage.pricingEffectiveDate)}
                              </div>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Detailed Calculation Steps - only shown when details are expanded */}
              {showDetailedUsage && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-lg font-semibold">Calculation Details</h3>
                  {data.aiUsage.map((usage, index) => (
                    <div
                      key={index}
                      className="border rounded-lg p-4 bg-slate-50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{usage.usageType}</Badge>
                          <Badge variant="secondary">{usage.modelUsed}</Badge>
                        </div>
                        <span className="font-semibold text-green-600">
                          {formatCurrency(usage.totalCost)}
                        </span>
                      </div>
                      <div className="font-mono text-sm space-y-1 text-slate-700">
                        <div className="text-blue-600">
                          {usage.calculationSteps.inputCalculation}
                        </div>
                        <div className="text-purple-600">
                          {usage.calculationSteps.outputCalculation}
                        </div>
                        <div className="text-green-600 font-semibold">
                          {usage.calculationSteps.totalCalculation}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        {isUserAdmin && (
          <TabsContent value="reports">
            <Card>
              <CardHeader>
                <CardTitle>Issue Reports</CardTitle>
              </CardHeader>
              <CardContent>
                {data.reports.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No reports submitted
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Issue Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell>
                            <Badge variant="outline">{report.issueType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <div
                              className="truncate"
                              title={report.description}
                            >
                              {report.description}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                report.status === "OPEN"
                                  ? "destructive"
                                  : "default"
                              }
                            >
                              {report.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(report.createdAt)}</TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openReportModal(report)}
                            >
                              View Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Modals */}
      <FeedbackModal
        feedback={selectedFeedback}
        isOpen={isFeedbackModalOpen}
        onClose={closeFeedbackModal}
      />

      <ReportModal
        report={selectedReport}
        isOpen={isReportModalOpen}
        onClose={closeReportModal}
      />
    </div>
  );
}
