"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, Filter, X } from "lucide-react";
import { QuickActions } from "./QuickActions";

interface DashboardFiltersProps {
  onFiltersChange: (filters: {
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  }) => void;
  onClearFilters: () => void;
  currentFilters: {
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  };
  sessionToken?: string | null;
  onQuickActionComplete?: (result: any) => void;
}

export function DashboardFilters({
  onFiltersChange,
  onClearFilters,
  currentFilters,
  sessionToken,
  onQuickActionComplete,
}: DashboardFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState(currentFilters);

  const handleFilterChange = (key: string, value: string | number) => {
    const newFilters = {
      ...localFilters,
      [key]: value === "" ? undefined : value,
    };
    setLocalFilters(newFilters);
  };

  const applyFilters = () => {
    onFiltersChange(localFilters);
  };

  const clearAllFilters = () => {
    const emptyFilters = {
      startDate: undefined,
      endDate: undefined,
      assignmentId: undefined,
      assignmentName: undefined,
      userId: undefined,
    };
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
    onClearFilters();
  };

  const hasActiveFilters = Object.values(currentFilters).some(
    (value) => value !== undefined && value !== "",
  );

  return (
    <div className="space-y-4 pb-4">
      <QuickActions
        sessionToken={sessionToken}
        onActionComplete={onQuickActionComplete}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="h-5 w-5" />
              Dashboard Filters
              {hasActiveFilters && (
                <span className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">
                  Active
                </span>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                {showFilters ? "Hide" : "Show"} Filters
              </Button>
            </div>
          </div>
        </CardHeader>

        {showFilters && (
          <CardContent className="space-y-4">
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
                  onChange={(e) => handleFilterChange("userId", e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={applyFilters} size="sm">
                Apply Filters
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocalFilters(currentFilters)}
                size="sm"
              >
                Reset
              </Button>
            </div>

            {hasActiveFilters && (
              <div className="border-t pt-4">
                <div className="text-sm text-muted-foreground mb-2">
                  Active Filters:
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentFilters.startDate && (
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                      From: {currentFilters.startDate}
                    </span>
                  )}
                  {currentFilters.endDate && (
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                      To: {currentFilters.endDate}
                    </span>
                  )}
                  {currentFilters.assignmentId && (
                    <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                      Assignment ID: {currentFilters.assignmentId}
                    </span>
                  )}
                  {currentFilters.assignmentName && (
                    <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                      Assignment: {currentFilters.assignmentName}
                    </span>
                  )}
                  {currentFilters.userId && (
                    <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                      User: {currentFilters.userId}
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
