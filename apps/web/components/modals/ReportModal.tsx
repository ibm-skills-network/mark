"use client";

import { AlertTriangle, FileText, Calendar, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Report {
  id: number;
  issueType: string;
  description: string;
  status: string;
  createdAt: string;
}

interface ReportModalProps {
  report: Report | null;
  isOpen: boolean;
  onClose: () => void;
}

const getStatusVariant = (
  status: string,
): "default" | "destructive" | "secondary" => {
  switch (status.toLowerCase()) {
    case "open":
      return "destructive";
    case "closed":
    case "resolved":
      return "default";
    case "in_progress":
    case "investigating":
      return "secondary";
    default:
      return "secondary";
  }
};

const getIssueTypeColor = (issueType: string): string => {
  switch (issueType.toLowerCase()) {
    case "bug":
      return "bg-red-100 text-red-800";
    case "feature_request":
      return "bg-blue-100 text-blue-800";
    case "content_issue":
      return "bg-yellow-100 text-yellow-800";
    case "technical_issue":
      return "bg-purple-100 text-purple-800";
    case "grading_issue":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

export function ReportModal({ report, isOpen, onClose }: ReportModalProps) {
  if (!report) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Issue Report Details
          </DialogTitle>
          <DialogDescription>
            Detailed view of submitted issue report
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Issue Type:</span>
              <Badge
                className={getIssueTypeColor(report.issueType)}
                variant="secondary"
              >
                {report.issueType.replace(/_/g, " ")}
              </Badge>
            </div>

            <Badge variant={getStatusVariant(report.status)}>
              {report.status}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Reported:</span>
            <span className="text-sm">{formatDate(report.createdAt)}</span>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-medium">Issue Description</h4>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {report.description || "No description provided"}
              </p>
            </div>
          </div>

          {report.status === "OPEN" && (
            <>
              <Separator />
              <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-sm text-red-700 font-medium">
                  This issue requires attention
                </span>
              </div>
            </>
          )}

          <Separator />
          <div className="text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Report ID: {report.id}</span>
              <span>Submitted: {formatDate(report.createdAt)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
