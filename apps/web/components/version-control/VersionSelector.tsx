"use client";

import React, { useState } from "react";
import { useVersionControl } from "@/hooks/useVersionControl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Modal from "@/components/Modal";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Clock, Save, History } from "lucide-react";

interface VersionSelectorProps {
  className?: string;
}

export function VersionSelector({ className = "" }: VersionSelectorProps) {
  const {
    versions,
    currentVersion,
    selectedVersion,
    isLoadingVersions,
    versionsLoadFailed,
    setSelectedVersion,
    activateVersion,
    createVersion,
    formatVersionAge,
    getDraftVersions,
    getPublishedVersions,
  } = useVersionControl();

  const [isCreateVersionOpen, setIsCreateVersionOpen] = useState(false);
  const [versionDescription, setVersionDescription] = useState("");

  const handleVersionSelect = (versionId: string) => {
    const version = versions.find((v) => v.id === parseInt(versionId));
    if (version) {
      setSelectedVersion(version);
    }
  };

  const handleActivateVersion = async (versionId: number) => {
    await activateVersion(versionId);
    setSelectedVersion(undefined);
  };

  const handleCreateVersion = async () => {
    await createVersion(versionDescription || undefined, false);
    setVersionDescription("");
    setIsCreateVersionOpen(false);
  };

  const publishedVersions = getPublishedVersions();
  const draftVersions = getDraftVersions();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Current Version Display */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <GitBranch className="h-4 w-4 text-gray-400" />
        <span>
          v{currentVersion?.versionNumber || "1"}
          {currentVersion?.isDraft && (
            <span className="text-xs text-gray-500 ml-1">(draft)</span>
          )}
        </span>
      </div>

      {/* Version Selector */}
      <Select onValueChange={handleVersionSelect} disabled={isLoadingVersions}>
        <SelectTrigger className="w-40 h-8 text-xs border-gray-300">
          <SelectValue placeholder="Switch version" />
        </SelectTrigger>
        <SelectContent>
          {publishedVersions.length > 0 && (
            <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase">
              Published Versions
            </div>
          )}
          {publishedVersions.map((version) => (
            <SelectItem key={version.id} value={version.id.toString()}>
              <div className="flex items-center justify-between w-full">
                <span>
                  v{version.versionNumber}
                  {version.isActive && " (Current)"}
                </span>
                <span className="text-xs text-gray-400 ml-2">
                  {formatVersionAge(version.createdAt)}
                </span>
              </div>
            </SelectItem>
          ))}

          {draftVersions.length > 0 && (
            <>
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase border-t mt-1 pt-2">
                Draft Versions
              </div>
              {draftVersions.map((version) => (
                <SelectItem key={version.id} value={version.id.toString()}>
                  <div className="flex items-center justify-between w-full">
                    <span>
                      Draft v{version.versionNumber}
                      {version.isActive && " (Current)"}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">
                      {formatVersionAge(version.createdAt)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </>
          )}
        </SelectContent>
      </Select>

      {/* Loading State */}
      {isLoadingVersions && (
        <div className="text-xs text-gray-500">Loading...</div>
      )}

      {/* Error State */}
      {versionsLoadFailed && (
        <div className="text-xs text-red-500">Failed to load versions</div>
      )}
    </div>
  );
}
