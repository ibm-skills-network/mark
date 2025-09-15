"use client";

import {
  getDashboardStats,
  upscalePricing,
  getCurrentPriceUpscaling,
  removePriceUpscaling,
} from "@/lib/shared";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  assignmentId?: number;
  assignmentName?: string;
  userId?: string;
}

interface DashboardStats {
  totalAssignments: number;
  publishedAssignments: number;
  totalReports: number;
  openReports: number;
  totalLearners: number;
  totalAttempts: number;
  totalCost: number;
  costBreakdown: {
    grading: number;
    questionGeneration: number;
    translation: number;
    other: number;
  };
  userRole: "admin" | "author";
  averageAssignmentRating?: number;
}

interface UpscalePricingData {
  globalFactor?: number;
  usageFactors?: { [usageType: string]: number };
  reason?: string;
}

// Query Keys
export const adminQueryKeys = {
  dashboardStats: (sessionToken: string, filters?: DashboardFilters) =>
    ["dashboard-stats", sessionToken, filters] as const,
  currentPriceUpscaling: (sessionToken: string) =>
    ["current-price-upscaling", sessionToken] as const,
};

// Custom hooks
export function useDashboardStats(
  sessionToken: string | null | undefined,
  filters?: DashboardFilters,
) {
  return useQuery({
    queryKey: adminQueryKeys.dashboardStats(sessionToken || "", filters),
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      return getDashboardStats(sessionToken, filters);
    },
    enabled: !!sessionToken,
    staleTime: 1000 * 60 * 2, // 2 minutes for dashboard stats
    gcTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useCurrentPriceUpscaling(
  sessionToken: string | null | undefined,
) {
  return useQuery({
    queryKey: adminQueryKeys.currentPriceUpscaling(sessionToken || ""),
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      const response = await getCurrentPriceUpscaling(sessionToken);
      return response.data;
    },
    enabled: !!sessionToken,
    staleTime: 1000 * 60, // 1 minute for pricing info
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUpscalePricing(sessionToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (upscaleData: UpscalePricingData) => {
      if (!sessionToken) throw new Error("Session token required");
      return upscalePricing(sessionToken, upscaleData);
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ["dashboard-stats", sessionToken],
      });
      queryClient.invalidateQueries({
        queryKey: ["current-price-upscaling", sessionToken],
      });
    },
  });
}

export function useRemovePriceUpscaling(
  sessionToken: string | null | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reason?: string) => {
      if (!sessionToken) throw new Error("Session token required");
      return removePriceUpscaling(sessionToken, reason);
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ["dashboard-stats", sessionToken],
      });
      queryClient.invalidateQueries({
        queryKey: ["current-price-upscaling", sessionToken],
      });
    },
  });
}

export function useRefreshDashboard(sessionToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return () => {
    if (!sessionToken) return;

    // Invalidate all dashboard-related queries
    queryClient.invalidateQueries({
      queryKey: ["dashboard-stats", sessionToken],
    });
    queryClient.invalidateQueries({
      queryKey: ["current-price-upscaling", sessionToken],
    });
  };
}
