"use client";

import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { AdminNav } from "../../components/AdminNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Eye,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { queryClient } from "@/lib/query-client";
import { useRouter } from "next/navigation";

interface RegradingRequestsContentProps {
  sessionToken: string | null;
  onLogout?: () => void;
}

interface RegradingRequest {
  id: number;
  assignmentId: number;
  userId: string;
  attemptId: number;
  regradingReason: string | null;
  proposedGrade: number | null;
  questionIds: number[];
  regradingStatus: string;
  processedBy: string | null;
  createdAt: string;
  updatedAt: string;
  assignment: {
    id: number;
    name: string;
  };
  assignmentAttempt: {
    id: number;
    userId: string;
    grade: number | null;
    createdAt: string;
  };
}

function RegradingRequestsTable({
  sessionToken,
}: {
  sessionToken: string | null;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedRequest, setSelectedRequest] =
    useState<RegradingRequest | null>(null);
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [newGrade, setNewGrade] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [filterAssignmentName, setFilterAssignmentName] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [sortBy, setSortBy] = useState<
    "date" | "assignment" | "status" | "grade"
  >("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewReasonDialogOpen, setViewReasonDialogOpen] = useState(false);
  const [selectedReasonRequest, setSelectedReasonRequest] =
    useState<RegradingRequest | null>(null);

  const {
    data: requests,
    isLoading,
    error,
    refetch,
  } = useQuery<RegradingRequest[]>({
    queryKey: ["regrading-requests"],
    queryFn: async () => {
      const response = await fetch("/api/v1/admin/regrading-requests", {
        headers: {
          "x-admin-token": sessionToken || "",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch regrading requests");
      }

      const data = await response.json();
      return data;
    },
    enabled: !!sessionToken,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, grade }: { id: number; grade: number }) => {
      const response = await fetch(
        `/api/v1/admin/regrading-requests/${id}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": sessionToken || "",
          },
          body: JSON.stringify({ newGrade: grade }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to approve request");
      }

      const result = await response.json();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regrading-requests"] });
      setIsApproveDialogOpen(false);
      setSelectedRequest(null);
      setNewGrade("");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const response = await fetch(
        `/api/v1/admin/regrading-requests/${id}/reject`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": sessionToken || "",
          },
          body: JSON.stringify({ reason }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reject request");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regrading-requests"] });
      setIsRejectDialogOpen(false);
      setSelectedRequest(null);
      setRejectionReason("");
    },
  });

  const handleApprove = (request: RegradingRequest) => {
    setSelectedRequest(request);
    const defaultGrade =
      request.proposedGrade !== null && request.proposedGrade !== undefined
        ? (request.proposedGrade * 100).toFixed(1)
        : request.assignmentAttempt?.grade
          ? (request.assignmentAttempt?.grade * 100).toFixed(1)
          : "";
    setNewGrade(defaultGrade);
    setIsApproveDialogOpen(true);
  };

  const handleReject = (request: RegradingRequest) => {
    setSelectedRequest(request);
    setIsRejectDialogOpen(true);
  };

  const handleManualReview = (request: RegradingRequest) => {
    let url = `/learner/${request.assignmentId}/successPage/${request.attemptId}?authorReview=true&regradingRequestId=${request.id}`;
    if (request.questionIds && request.questionIds.length > 0) {
      url += `&highlightQuestionIds=${request.questionIds.join(",")}`;
    }
    router.push(url);
  };

  const handleApproveSubmit = () => {
    if (selectedRequest && newGrade) {
      const gradeDecimal = Number(newGrade) / 100;
      approveMutation.mutate({
        id: selectedRequest.id,
        grade: gradeDecimal,
      });
    }
  };

  const handleRejectSubmit = () => {
    if (selectedRequest && rejectionReason) {
      rejectMutation.mutate({
        id: selectedRequest.id,
        reason: rejectionReason,
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return (
          <Badge
            variant="outline"
            className="bg-yellow-50 text-yellow-700 border-yellow-200"
          >
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "APPROVED":
        return (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200"
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200"
          >
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const getSortIcon = (column: typeof sortBy) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 inline" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="h-4 w-4 ml-1 inline" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1 inline" />
    );
  };

  const handleViewReason = (request: RegradingRequest) => {
    setSelectedReasonRequest(request);
    setViewReasonDialogOpen(true);
  };

  const filteredAndSortedRequests = requests
    ?.filter((request) => {
      const matchesAssignment = filterAssignmentName
        ? request.assignment?.name
            .toLowerCase()
            .includes(filterAssignmentName.toLowerCase())
        : true;

      const matchesUserId = filterUserId
        ? request.userId.toLowerCase().includes(filterUserId.toLowerCase())
        : true;

      return matchesAssignment && matchesUserId;
    })
    ?.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "date":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "assignment":
          comparison = (a.assignment?.name || "").localeCompare(
            b.assignment?.name || "",
          );
          break;
        case "status":
          comparison = a.regradingStatus.localeCompare(b.regradingStatus);
          break;
        case "grade": {
          const gradeA = a.assignmentAttempt?.grade ?? -1;
          const gradeB = b.assignmentAttempt?.grade ?? -1;
          comparison = gradeA - gradeB;
          break;
        }
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-600">Error loading regrading requests</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Filter by assignment name..."
            value={filterAssignmentName}
            onChange={(e) => setFilterAssignmentName(e.target.value)}
          />
        </div>
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Filter by user ID..."
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
          />
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Regrading Requests ({filteredAndSortedRequests?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredAndSortedRequests && filteredAndSortedRequests.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort("assignment")}
                  >
                    Assignment {getSortIcon("assignment")}
                  </TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort("grade")}
                  >
                    Current Grade {getSortIcon("grade")}
                  </TableHead>
                  <TableHead>AI Proposed</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort("status")}
                  >
                    Status {getSortIcon("status")}
                  </TableHead>
                  <TableHead>Processed By</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort("date")}
                  >
                    Submitted {getSortIcon("date")}
                  </TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="font-medium">
                      {request.assignment?.name}
                    </TableCell>
                    <TableCell>{request.userId}</TableCell>
                    <TableCell>
                      {request.assignmentAttempt?.grade !== null
                        ? `${(request.assignmentAttempt?.grade * 100).toFixed(1)}%`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {request.proposedGrade !== null ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="bg-purple-50 text-purple-700 border-purple-200"
                          >
                            {(request.proposedGrade * 100).toFixed(1)}%
                          </Badge>
                          {request.assignmentAttempt?.grade !== null && (
                            <span className="text-xs text-gray-500">
                              (
                              {(request.proposedGrade -
                                request.assignmentAttempt.grade) *
                                100 >=
                              0
                                ? "+"
                                : ""}
                              {(
                                (request.proposedGrade -
                                  request.assignmentAttempt.grade) *
                                100
                              ).toFixed(1)}
                              %)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">
                          No proposal
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {request.regradingReason || "No reason provided"}
                        </span>
                        <Button
                          onClick={() => handleViewReason(request)}
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs flex-shrink-0"
                        >
                          View
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(request.regradingStatus)}
                    </TableCell>
                    <TableCell>
                      {request.processedBy ? (
                        <span className="text-sm text-gray-700">
                          {request.processedBy}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {request.createdAt
                        ? (() => {
                            const date = new Date(request.createdAt);
                            return isNaN(date.getTime())
                              ? "N/A"
                              : date.toLocaleDateString();
                          })()
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {request.regradingStatus === "PENDING" && (
                          <>
                            <Button
                              onClick={() => handleManualReview(request)}
                              variant="outline"
                              size="sm"
                              className="text-purple-600 hover:bg-purple-50"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Manual Review
                            </Button>
                            <Button
                              onClick={() => handleApprove(request)}
                              variant="outline"
                              size="sm"
                              className="text-green-600 hover:bg-green-50"
                            >
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleReject(request)}
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:bg-red-50"
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {request.regradingStatus !== "PENDING" && (
                          <Button
                            onClick={() => handleManualReview(request)}
                            variant="outline"
                            size="sm"
                            className="text-purple-600 hover:bg-purple-50"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View Attempt
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-gray-500 py-8">
              No regrading requests found
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Regrading Request</DialogTitle>
            <DialogDescription>
              Enter the new grade for this assignment attempt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="newGrade">New Grade (%)</Label>
              <Input
                id="newGrade"
                type="number"
                min="0"
                max="100"
                value={newGrade}
                onChange={(e) => setNewGrade(e.target.value)}
                placeholder="Enter grade (0-100)"
              />
            </div>
            {selectedRequest && (
              <div className="text-sm text-gray-600 space-y-2">
                <p>
                  <strong>Assignment:</strong>{" "}
                  {selectedRequest.assignment?.name}
                </p>
                <p>
                  <strong>Current Grade:</strong>{" "}
                  {selectedRequest.assignmentAttempt?.grade !== null
                    ? `${(selectedRequest.assignmentAttempt?.grade * 100).toFixed(1)}%`
                    : "N/A"}
                </p>
                {selectedRequest.proposedGrade !== null && (
                  <div className="bg-purple-50 border border-purple-200 rounded p-3">
                    <p className="font-semibold text-purple-900">
                      AI Proposed Grade:
                    </p>
                    <p className="text-lg font-bold text-purple-700">
                      {(selectedRequest.proposedGrade * 100).toFixed(1)}%
                      {selectedRequest.assignmentAttempt?.grade !== null && (
                        <span className="text-sm font-normal ml-2">
                          (
                          {(selectedRequest.proposedGrade -
                            selectedRequest.assignmentAttempt.grade) *
                            100 >=
                          0
                            ? "+"
                            : ""}
                          {(
                            (selectedRequest.proposedGrade -
                              selectedRequest.assignmentAttempt.grade) *
                            100
                          ).toFixed(1)}
                          % change)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-purple-600 mt-1">
                      The AI has analyzed the student's submission and proposed
                      this grade based on their concerns.
                    </p>
                  </div>
                )}
                <p>
                  <strong>Reason:</strong>{" "}
                  {selectedRequest.regradingReason || "No reason provided"}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsApproveDialogOpen(false)}
              disabled={approveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApproveSubmit}
              disabled={!newGrade || approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Regrading Request</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this regrading request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejectionReason">Rejection Reason</Label>
              <Textarea
                id="rejectionReason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={4}
              />
            </div>
            {selectedRequest && (
              <div className="text-sm text-gray-600">
                <p>
                  <strong>Assignment:</strong>{" "}
                  {selectedRequest.assignment?.name}
                </p>
                <p>
                  <strong>Student Reason:</strong>{" "}
                  {selectedRequest.regradingReason || "No reason provided"}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRejectDialogOpen(false)}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={!rejectionReason || rejectMutation.isPending}
              variant="destructive"
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={viewReasonDialogOpen}
        onOpenChange={setViewReasonDialogOpen}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Full Regrading Reason</DialogTitle>
            <DialogDescription>
              Complete reason for regrading request
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedReasonRequest && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Assignment</p>
                    <p className="font-medium">
                      {selectedReasonRequest.assignment?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Student ID</p>
                    <p className="font-medium">
                      {selectedReasonRequest.userId}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Question Complained About</p>
                    <p className="font-medium">
                      {selectedReasonRequest.questionIds.length > 0 ? (
                        <Badge
                          variant="outline"
                          className="bg-orange-50 text-orange-700 border-orange-200"
                        >
                          Question{" "}
                          {selectedReasonRequest.questionIds.join(", ")}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">General</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Current Grade</p>
                    <p className="font-medium">
                      {selectedReasonRequest.assignmentAttempt?.grade !== null
                        ? `${(selectedReasonRequest.assignmentAttempt?.grade * 100).toFixed(1)}%`
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">AI Proposed Grade</p>
                    <p className="font-medium">
                      {selectedReasonRequest.proposedGrade !== null ? (
                        <span className="text-purple-700">
                          {(selectedReasonRequest.proposedGrade * 100).toFixed(
                            1,
                          )}
                          %
                        </span>
                      ) : (
                        <span className="text-gray-400">No proposal</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Status</p>
                    <p className="font-medium">
                      {getStatusBadge(selectedReasonRequest.regradingStatus)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Submitted</p>
                    <p className="font-medium">
                      {new Date(
                        selectedReasonRequest.createdAt,
                      ).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <p className="text-gray-500 mb-2">Reason for Regrading:</p>
                  <div className="bg-gray-50 p-4 rounded-md max-h-96 overflow-y-auto">
                    <p className="whitespace-pre-wrap text-sm">
                      {selectedReasonRequest.regradingReason ||
                        "No reason provided"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setViewReasonDialogOpen(false)}
            >
              Close
            </Button>
            {selectedReasonRequest &&
              selectedReasonRequest.regradingStatus === "PENDING" && (
                <>
                  <Button
                    onClick={() => {
                      setViewReasonDialogOpen(false);
                      handleManualReview(selectedReasonRequest);
                    }}
                    variant="default"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Manual Review
                  </Button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RegradingRequestsContent({
  sessionToken,
  onLogout,
}: RegradingRequestsContentProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        <AdminNav onLogout={onLogout} />
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-3xl font-bold">Regrading Requests</h1>
              <p className="text-gray-600 mt-2">
                Review and manage student regrading requests for your
                assignments
              </p>
            </div>
            <RegradingRequestsTable sessionToken={sessionToken} />
          </div>
        </div>
      </div>
    </QueryClientProvider>
  );
}
