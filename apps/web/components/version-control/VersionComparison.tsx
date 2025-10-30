"use client";

import React from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Modal from "@/components/Modal";
import {
  GitCompare,
  Plus,
  Minus,
  Edit,
  FileText,
  HelpCircle,
} from "lucide-react";

interface VersionComparisonProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VersionComparison({ isOpen, onClose }: VersionComparisonProps) {
  const { versionComparison, setVersionComparison } = useVersionControl();

  if (!versionComparison) return null;

  const { fromVersion, toVersion, assignmentChanges, questionChanges } =
    versionComparison;

  const handleClose = () => {
    setVersionComparison(undefined);
    onClose();
  };

  const getChangeIcon = (changeType: string) => {
    switch (changeType) {
      case "added":
        return <Plus className="h-3 w-3 text-green-600" />;
      case "removed":
        return <Minus className="h-3 w-3 text-red-600" />;
      case "modified":
        return <Edit className="h-3 w-3 text-blue-600" />;
      default:
        return <Edit className="h-3 w-3 text-gray-600" />;
    }
  };

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case "added":
        return "bg-green-50 border-green-200";
      case "removed":
        return "bg-red-50 border-red-200";
      case "modified":
        return "bg-blue-50 border-blue-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const formatFieldName = (field: string) => {
    return field
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  const formatValue = (value: any) => {
    if (value === null || value === undefined) {
      return <span className="text-gray-400 italic">Not set</span>;
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    if (typeof value === "string" && value.length > 100) {
      return (
        <div className="space-y-1">
          <div className="text-sm">{value.substring(0, 100)}...</div>
          <Button variant="ghost" size="sm" className="text-xs h-auto p-1">
            Show more
          </Button>
        </div>
      );
    }

    return String(value);
  };

  if (!isOpen) return null;

  return (
    <Modal onClose={handleClose} Title="Version Comparison">
      <div className="space-y-6 overflow-y-auto max-h-[60vh]">
        <div className="grid grid-cols-2 gap-4 pb-4 border-b">
          <div className="space-y-2">
            <h3 className="font-semibold text-red-700 flex items-center gap-2">
              <Minus className="h-4 w-4" />
              From: Version {fromVersion.versionNumber}
            </h3>
            <div className="text-sm text-gray-600">
              <div>
                Created: {new Date(fromVersion.createdAt).toLocaleString()}
              </div>
              <div>By: {fromVersion.createdBy}</div>
              {fromVersion.versionDescription && (
                <div className="mt-1 italic">
                  "{fromVersion.versionDescription}"
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-green-700 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              To: Version {toVersion.versionNumber}
            </h3>
            <div className="text-sm text-gray-600">
              <div>
                Created: {new Date(toVersion.createdAt).toLocaleString()}
              </div>
              <div>By: {toVersion.createdBy}</div>
              {toVersion.versionDescription && (
                <div className="mt-1 italic">
                  "{toVersion.versionDescription}"
                </div>
              )}
            </div>
          </div>
        </div>

        {assignmentChanges.length > 0 && (
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Assignment Changes ({assignmentChanges.length})
            </h3>

            <div className="space-y-3">
              {assignmentChanges.map((change, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${getChangeColor(change.changeType)}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getChangeIcon(change.changeType)}
                    <span className="font-medium">
                      {formatFieldName(change.field)}
                    </span>
                    <Badge variant="outline" className="capitalize text-xs">
                      {change.changeType}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-red-700 font-medium mb-1">
                        Before:
                      </div>
                      <div className="p-2 bg-red-50 rounded border">
                        {formatValue(change.fromValue)}
                      </div>
                    </div>

                    <div>
                      <div className="text-green-700 font-medium mb-1">
                        After:
                      </div>
                      <div className="p-2 bg-green-50 rounded border">
                        {formatValue(change.toValue)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {questionChanges.length > 0 && (
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              Question Changes ({questionChanges.length})
            </h3>

            <div className="space-y-3">
              {questionChanges.map((change, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${getChangeColor(change.changeType)}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getChangeIcon(change.changeType)}
                    <span className="font-medium">
                      Question #{change.displayOrder}
                      {change.questionId && ` (ID: ${change.questionId})`}
                    </span>
                    <Badge variant="outline" className="capitalize text-xs">
                      {change.changeType}
                    </Badge>
                  </div>

                  {change.field && (
                    <div className="text-sm mb-2 text-gray-600">
                      Field:{" "}
                      <span className="font-medium">
                        {formatFieldName(change.field)}
                      </span>
                    </div>
                  )}

                  {change.fromValue !== undefined &&
                    change.toValue !== undefined && (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-red-700 font-medium mb-1">
                            Before:
                          </div>
                          <div className="p-2 bg-red-50 rounded border">
                            {formatValue(change.fromValue)}
                          </div>
                        </div>

                        <div>
                          <div className="text-green-700 font-medium mb-1">
                            After:
                          </div>
                          <div className="p-2 bg-green-50 rounded border">
                            {formatValue(change.toValue)}
                          </div>
                        </div>
                      </div>
                    )}
                </div>
              ))}
            </div>
          </div>
        )}

        {assignmentChanges.length === 0 && questionChanges.length === 0 && (
          <div className="text-center py-12">
            <GitCompare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No Changes Found
            </h3>
            <p className="text-gray-500">
              These two versions appear to be identical.
            </p>
          </div>
        )}

        {(assignmentChanges.length > 0 || questionChanges.length > 0) && (
          <div className="bg-gray-50 p-4 rounded-lg border-t">
            <h3 className="font-semibold mb-2">Summary</h3>
            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <div className="text-green-600 font-bold text-lg">
                  {
                    [...assignmentChanges, ...questionChanges].filter(
                      (c) => c.changeType === "added",
                    ).length
                  }
                </div>
                <div className="text-gray-600">Added</div>
              </div>
              <div>
                <div className="text-blue-600 font-bold text-lg">
                  {
                    [...assignmentChanges, ...questionChanges].filter(
                      (c) => c.changeType === "modified",
                    ).length
                  }
                </div>
                <div className="text-gray-600">Modified</div>
              </div>
              <div>
                <div className="text-red-600 font-bold text-lg">
                  {
                    [...assignmentChanges, ...questionChanges].filter(
                      (c) => c.changeType === "removed",
                    ).length
                  }
                </div>
                <div className="text-gray-600">Removed</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleClose}>Close</Button>
      </div>
    </Modal>
  );
}
