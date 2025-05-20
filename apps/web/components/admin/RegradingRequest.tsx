// components/admin/RegradingRequests.tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { RegradingRequest } from "@/config/types";
import RegradingDetailsModal from "./RequestRegradingModal";
import LoadingSpinner from "../Loading";
import {
  useGetRegradingRequestsQuery,
  useApproveRegradingRequestMutation,
  useRejectRegradingRequestMutation,
} from "@/lib/admin";
import animationData from "@/animations/LoadSN.json";

export default function RegradingRequests() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [sortBy, setSortBy] = useState<"date" | "assignment">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [selectedRequest, setSelectedRequest] =
    useState<RegradingRequest | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  // RTK Query hooks
  const {
    data: regradingRequests = [],
    isLoading,
    error,
  } = useGetRegradingRequestsQuery();

  const [approveRequest, { isLoading: isApproving }] =
    useApproveRegradingRequestMutation();

  const [rejectRequest, { isLoading: isRejecting }] =
    useRejectRegradingRequestMutation();

  // Filter and sort requests
  const filteredRequests = regradingRequests
    .filter((request) => {
      // Apply search filter (user ID or reason)
      if (
        searchTerm &&
        !request.userId.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !request.reason.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      // Apply status filter
      if (
        statusFilter === "pending" &&
        request.regradingStatus !== "PENDING"
      ) {
        return false;
      }
      if (
        statusFilter === "approved" &&
        request.regradingStatus !== "APPROVED"
      ) {
        return false;
      }
      if (
        statusFilter === "rejected" &&
        request.regradingStatus !== "REJECTED"
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Apply sorting
      if (sortBy === "date") {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      }

      if (sortBy === "assignment") {
        return sortDirection === "asc"
          ? a.assignmentId - b.assignmentId
          : b.assignmentId - a.assignmentId;
      }

      return 0;
    });

  const handleSort = (key: "date" | "assignment") => {
    if (sortBy === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDirection("asc");
    }
  };

  const handleOpenDetails = (request: RegradingRequest) => {
    setSelectedRequest(request);
    setIsDetailsModalOpen(true);
  };

  const handleApproveRequest = async (requestId: number, newGrade: number) => {
    try {
      await approveRequest({ id: requestId, newGrade }).unwrap();
      setIsDetailsModalOpen(false);
      // Success toast could be added here
    } catch (error) {
      console.error("Failed to approve request:", error);
      // Error toast could be added here
    }
  };

  const handleRejectRequest = async (requestId: number, reason: string) => {
    try {
      await rejectRequest({ id: requestId, reason }).unwrap();
      setIsDetailsModalOpen(false);
      // Success toast could be added here
    } catch (error) {
      console.error("Failed to reject request:", error);
      // Error toast could be added here
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <ClockIcon className="h-3.5 w-3.5 mr-1" />
            Pending
          </span>
        );
      case "APPROVED":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
            Approved
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircleIcon className="h-3.5 w-3.5 mr-1" />
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading regrading requests: {error.toString()}
      </div>
    );
  }

  const isProcessing = isApproving || isRejecting;

  return (
    <div className="space-y-6">
      {/* Filters & Actions */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex flex-1 items-center">
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-3 py-2 w-full border border-gray-300 rounded-md focus:ring-violet-500 focus:border-violet-500"
                placeholder="Search by user ID or reason..."
                disabled={isLoading || isProcessing}
              />
            </div>

            <div className="ml-2">
              <button
                onClick={() => {
                  setStatusFilter(
                    statusFilter === "all"
                      ? "pending"
                      : statusFilter === "pending"
                        ? "approved"
                        : statusFilter === "approved"
                          ? "rejected"
                          : "all",
                  );
                }}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading || isProcessing}
              >
                <FunnelIcon className="h-5 w-5 mr-2" />
                <span>
                  {statusFilter === "all"
                    ? "All Statuses"
                    : statusFilter === "pending"
                      ? "Pending"
                      : statusFilter === "approved"
                        ? "Approved"
                        : "Rejected"}
                </span>
              </button>
            </div>

            <div className="ml-2">
              <button
                onClick={() =>
                  handleSort(sortBy === "date" ? "assignment" : "date")
                }
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading || isProcessing}
              >
                <ArrowsUpDownIcon className="h-5 w-5 mr-2" />
                <span>
                  Sort by {sortBy === "date" ? "Date" : "Assignment"}{" "}
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Requests List */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner animationData={animationData} />
        </div>
      ) : filteredRequests.length > 0 ? (
        <div className="space-y-4">
          <AnimatePresence>
            {filteredRequests.map((request, index) => (
              <motion.div
                key={request.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-300"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Assignment ID: {request.assignmentId}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      User ID: {request.userId} | Attempt ID:{" "}
                      {request.attemptId}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Submitted: {formatDate(request.createdAt)}
                    </p>
                  </div>
                  <div>{getStatusBadge(request.regradingStatus)}</div>
                </div>

                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">
                    Reason:
                  </h4>
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {request.reason}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => handleOpenDetails(request)}
                    className="inline-flex items-center px-3 py-1.5 border border-violet-500 text-violet-600 bg-white hover:bg-violet-50 rounded-md text-sm font-medium transition-colors"
                    disabled={isProcessing}
                  >
                    View Details
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-100 text-center">
          <ExclamationCircleIcon className="w-16 h-16 mx-auto text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No regrading requests found
          </h3>
          <p className="mt-2 text-gray-500">
            {searchTerm || statusFilter !== "all"
              ? "Try adjusting your search or filters"
              : "All regrading requests will appear here"}
          </p>
        </div>
      )}

      {/* Regrading Details Modal */}
      {selectedRequest && isDetailsModalOpen && (
        <RegradingDetailsModal
          request={selectedRequest}
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          onApprove={handleApproveRequest}
          onReject={handleRejectRequest}
        />
      )}
    </div>
  );
}