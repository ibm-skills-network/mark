"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  TrendingUp,
  Users,
  DollarSign,
  Star,
  Activity,
  BarChart,
  Target,
  AlertTriangle,
  Award,
  X,
} from "lucide-react";
import { executeQuickAction } from "@/lib/shared";

interface QuickActionsProps {
  sessionToken?: string | null;
  onActionComplete?: (result: QuickActionResult) => void;
}

interface QuickActionResult {
  title: string;
  data: Array<Record<string, unknown>>;
}

const quickActions = [
  {
    id: "top-assignments-by-cost",
    name: "Top Assignments by AI Cost",
    description: "Find assignments with highest AI processing costs",
    icon: DollarSign,
    category: "Cost Analysis",
    color: "bg-red-100 text-red-800 border-red-200",
  },
  {
    id: "top-assignments-by-attempts",
    name: "Most Attempted Assignments",
    description: "Assignments with highest number of attempts",
    icon: TrendingUp,
    category: "Activity",
    color: "bg-blue-100 text-blue-800 border-blue-200",
  },
  {
    id: "top-assignments-by-learners",
    name: "Assignments with Most Learners",
    description: "Find assignments with highest learner engagement",
    icon: Users,
    category: "Engagement",
    color: "bg-green-100 text-green-800 border-green-200",
  },
  {
    id: "most-expensive-assignments",
    name: "Most Expensive Assignments",
    description: "Assignments with highest total costs",
    icon: DollarSign,
    category: "Cost Analysis",
    color: "bg-red-100 text-red-800 border-red-200",
  },
  {
    id: "assignments-with-most-reports",
    name: "Assignments with Most Reports",
    description: "Find assignments generating most issue reports",
    icon: AlertTriangle,
    category: "Quality",
    color: "bg-orange-100 text-orange-800 border-orange-200",
  },
  {
    id: "highest-rated-assignments",
    name: "Highest Rated Assignments",
    description: "Best performing assignments by learner ratings",
    icon: Star,
    category: "Quality",
    color: "bg-yellow-100 text-yellow-800 border-yellow-200",
  },
  {
    id: "assignments-with-lowest-ratings",
    name: "Lowest Rated Assignments",
    description: "Assignments needing attention based on ratings",
    icon: Star,
    category: "Quality",
    color: "bg-gray-100 text-gray-800 border-gray-200",
  },
  {
    id: "recent-high-activity",
    name: "Recent High Activity",
    description: "Assignments with high activity in last 7 days",
    icon: Activity,
    category: "Activity",
    color: "bg-purple-100 text-purple-800 border-purple-200",
  },
  {
    id: "cost-per-learner-analysis",
    name: "Cost Per Learner Analysis",
    description: "Analyze cost efficiency per learner",
    icon: BarChart,
    category: "Cost Analysis",
    color: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  {
    id: "completion-rate-analysis",
    name: "Completion Rate Analysis",
    description: "Analyze assignment completion rates",
    icon: Target,
    category: "Performance",
    color: "bg-teal-100 text-teal-800 border-teal-200",
  },
];

const categories = [
  "All",
  "Cost Analysis",
  "Activity",
  "Engagement",
  "Quality",
  "Performance",
];

export function QuickActions({
  sessionToken,
  onActionComplete,
}: QuickActionsProps) {
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [limit, setLimit] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState<boolean>(false);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const filteredActions =
    selectedCategory === "All"
      ? quickActions
      : quickActions.filter((action) => action.category === selectedCategory);

  const handleExecuteAction = async () => {
    if (!selectedAction || !sessionToken) return;

    const startTime = Date.now();
    setLoading(true);
    setError(null);
    setResult(null);
    setShowResults(false);

    try {
      const actionResult = (await executeQuickAction(
        sessionToken,
        selectedAction,
        limit,
      )) as QuickActionResult;
      const endTime = Date.now();
      setExecutionTime(endTime - startTime);

      setResult(actionResult);
      onActionComplete?.(actionResult);
      setIsOpen(false); // Close modal after successful execution

      // Animate results appearance
      setTimeout(() => {
        setShowResults(true);
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute action");
    } finally {
      setLoading(false);
    }
  };

  // Reset state when modal closes
  const handleModalOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSelectedAction("");
      setError(null);
      setResult(null);
      setShowResults(false);
    }
  };

  const selectedActionInfo = quickActions.find(
    (action) => action.id === selectedAction,
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleModalOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Quick Actions
          <Badge variant="secondary" className="ml-1">
            Analytics
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600" />
            Quick Actions
          </DialogTitle>
          <DialogDescription>
            Run pre-built analytics queries to gain instant insights into your
            data
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Category Filter */}
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Filter by category:</label>
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Action Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredActions.map((action) => {
              const Icon = action.icon;
              const isSelected = selectedAction === action.id;
              return (
                <Card
                  key={action.id}
                  className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105 ${
                    isSelected
                      ? "ring-2 ring-blue-500 border-blue-300 shadow-lg"
                      : "hover:border-blue-200"
                  } ${action.color.replace("bg-", "hover:bg-").replace("text-", "hover:text-").replace("border-", "hover:border-")}`}
                  onClick={() => setSelectedAction(action.id)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Icon className="h-4 w-4" />
                      {action.name}
                      {isSelected && (
                        <Badge variant="secondary" className="text-xs">
                          Selected
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground mb-2">
                      {action.description}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {action.category}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Action Controls */}
          {selectedAction && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-sm">Execute Action</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Results Limit */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">Results Limit:</label>
                  <Select
                    value={limit.toString()}
                    onValueChange={(value) => setLimit(parseInt(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 results</SelectItem>
                      <SelectItem value="10">10 results</SelectItem>
                      <SelectItem value="20">20 results</SelectItem>
                      <SelectItem value="50">50 results</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Execute Button */}
                <Button
                  onClick={handleExecuteAction}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Executing...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Execute Action
                    </>
                  )}
                </Button>

                {/* Error Display */}
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <div>
                        <p className="font-medium text-sm">Error</p>
                        <p className="text-xs mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
