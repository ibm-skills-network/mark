"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PlusIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  AcademicCapIcon,
  DocumentTextIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

import { Assignment } from "@/config/types";
import AssignmentCard from "./AssignmentCard";
import CreateAssignmentModal from "./CreateAssignmentModal";
import ShareAssignmentModal from "./ShareAssignmentModal";
import { useGetAssignmentsQuery, useDeleteAssignmentMutation } from "@/lib/admin";

export default function AssignmentsDashboard() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "date" | "status">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filterStatus, setFilterStatus] = useState<"all" | "published" | "draft">("all");

  // Use RTK Query hook to fetch assignments
  const { data: assignments = [], isLoading, error } = useGetAssignmentsQuery();
  
  // Use RTK Query mutation hook for delete operation
  const [deleteAssignment, { isLoading: isDeleting }] = useDeleteAssignmentMutation();

  // Filter and sort assignments
  const filteredAssignments = assignments
    .filter((assignment) => {
      // Apply search filter
      if (searchTerm && !assignment.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Apply status filter
      if (filterStatus === "published" && !assignment.published) {
        return false;
      }
      if (filterStatus === "draft" && assignment.published) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Apply sorting
      if (sortBy === "name") {
        return sortDirection === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }

      if (sortBy === "date") {
        const dateA = new Date(a.updatedAt).getTime();
        const dateB = new Date(b.updatedAt).getTime();
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      }

      if (sortBy === "status") {
        return sortDirection === "asc"
          ? (a.published ? 1 : 0) - (b.published ? 1 : 0)
          : (b.published ? 1 : 0) - (a.published ? 1 : 0);
      }

      return 0;
    });

  const handleSort = (key: "name" | "date" | "status") => {
    if (sortBy === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDirection("asc");
    }
  };

  const handleShareAssignment = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setIsShareModalOpen(true);
  };

  const handleDeleteAssignment = async (assignmentId: number) => {
    if (window.confirm("Are you sure you want to delete this assignment? This action cannot be undone.")) {
      try {
        await deleteAssignment(assignmentId).unwrap();
        // You could add a success toast notification here
      } catch (error) {
        console.error("Failed to delete assignment:", error);
        // You could add an error toast notification here
      }
    }
  };

  // Stats data derived from actual data
  const stats = [
    {
      name: "Total Assignments",
      value: assignments.length,
      icon: DocumentTextIcon,
      color: "bg-blue-100 text-blue-600",
    },
    {
      name: "Active Learners",
      value: 254, // This might need to come from a different API endpoint
      icon: UserIcon,
      color: "bg-green-100 text-green-600",
    },
    {
      name: "Published",
      value: assignments.filter((a) => a.published).length,
      icon: AcademicCapIcon,
      color: "bg-violet-100 text-violet-600",
    },
    {
      name: "Pending Review",
      value: 12, // This might need to come from a different API endpoint
      icon: DocumentTextIcon,
      color: "bg-amber-100 text-amber-600",
    },
  ];

  // Show error state
  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading assignments: {error.toString()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stat.value}
                </p>
              </div>
              <div className={`p-3 rounded-full ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

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
                placeholder="Search assignments..."
                disabled={isLoading}
              />
            </div>

            <div className="ml-2">
              <button
                onClick={() => {
                  // Toggle between all, published, draft
                  setFilterStatus(
                    filterStatus === "all"
                      ? "published"
                      : filterStatus === "published"
                        ? "draft"
                        : "all",
                  );
                }}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading}
              >
                <FunnelIcon className="h-5 w-5 mr-2" />
                <span>
                  {filterStatus === "all"
                    ? "All"
                    : filterStatus === "published"
                      ? "Published"
                      : "Drafts"}
                </span>
              </button>
            </div>

            <div className="ml-2">
              <button
                onClick={() =>
                  handleSort(
                    sortBy === "name"
                      ? "date"
                      : sortBy === "date"
                        ? "status"
                        : "name",
                  )
                }
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading}
              >
                <ArrowsUpDownIcon className="h-5 w-5 mr-2" />
                <span>
                  Sort by{" "}
                  {sortBy === "name"
                    ? "Name"
                    : sortBy === "date"
                      ? "Date"
                      : "Status"}{" "}
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              </button>
            </div>
          </div>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
            disabled={isLoading || isDeleting}
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            New Assignment
          </button>
        </div>
      </div>

      {/* Assignments Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, index) => (
            <div
              key={index}
              className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6 mb-4"></div>
              <div className="flex justify-between items-center mt-6">
                <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                <div className="h-8 bg-gray-200 rounded w-1/3"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredAssignments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {filteredAssignments.map((assignment, index) => (
              <motion.div
                key={assignment.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <AssignmentCard
                  assignment={assignment}
                  onShare={() => handleShareAssignment(assignment)}
                  onDelete={() => handleDeleteAssignment(assignment.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-100 text-center">
          <DocumentTextIcon className="w-16 h-16 mx-auto text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No assignments found
          </h3>
          <p className="mt-2 text-gray-500">
            {searchTerm || filterStatus !== "all"
              ? "Try adjusting your search or filters"
              : "Get started by creating a new assignment"}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-6 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Create Assignment
          </button>
        </div>
      )}

      {/* Create Assignment Modal */}
      {isCreateModalOpen && (
        <CreateAssignmentModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      )}

      {/* Share Assignment Modal */}
      {isShareModalOpen && selectedAssignment && (
        <ShareAssignmentModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          assignment={selectedAssignment}
        />
      )}
    </div>
  );
}