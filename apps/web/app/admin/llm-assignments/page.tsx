"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Settings,
  Zap,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { formatPricePerMillionTokens } from "@/config/constants";

interface AIFeature {
  id: number;
  featureKey: string;
  featureType: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  requiresModel: boolean;
  defaultModelKey?: string;
  assignedModel?: {
    id: number;
    modelKey: string;
    displayName: string;
    provider: string;
    priority: number;
    assignedBy?: string;
    assignedAt: Date;
  };
}

interface LLMModel {
  id: number;
  modelKey: string;
  displayName: string;
  provider: string;
  isActive: boolean;
  currentPricing: {
    inputTokenPrice: number;
    outputTokenPrice: number;
  } | null;
  assignedFeatures: Array<{
    featureKey: string;
    featureDisplayName: string;
    priority: number;
  }>;
}

export default function LLMAssignmentsPage() {
  const router = useRouter();
  const [features, setFeatures] = useState<AIFeature[]>([]);
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [changes, setChanges] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const sessionToken = localStorage.getItem("adminSessionToken");
    if (!sessionToken) {
      router.push(
        `/admin?returnTo=${encodeURIComponent(window.location.pathname)}`,
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [featuresRes, modelsRes] = await Promise.all([
        fetch("/api/v1/llm-assignments/features", {
          headers: { "x-admin-token": sessionToken },
        }),
        fetch("/api/v1/llm-assignments/models", {
          headers: { "x-admin-token": sessionToken },
        }),
      ]);

      if (!featuresRes.ok || !modelsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const featuresData = await featuresRes.json();
      const modelsData = await modelsRes.json();

      setFeatures(featuresData.data || []);
      setModels(modelsData.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  const handleModelChange = (featureKey: string, modelKey: string) => {
    const newChanges = new Map(changes);

    // Find the current assignment
    const feature = features.find((f) => f.featureKey === featureKey);
    const currentModelKey = feature?.assignedModel?.modelKey;

    if (currentModelKey === modelKey) {
      // No change from current assignment
      newChanges.delete(featureKey);
    } else {
      newChanges.set(featureKey, modelKey);
    }

    setChanges(newChanges);
  };

  const saveChanges = async () => {
    if (changes.size === 0) return;

    const sessionToken = localStorage.getItem("adminSessionToken");
    if (!sessionToken) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const assignments = Array.from(changes.entries()).map(
        ([featureKey, modelKey]) => ({
          featureKey,
          modelKey,
        }),
      );

      const response = await fetch("/api/v1/llm-assignments/bulk-assign", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": sessionToken,
        },
        body: JSON.stringify({ assignments }),
      });

      if (!response.ok) {
        throw new Error("Failed to save assignments");
      }

      const result = await response.json();

      if (result.success) {
        setSuccess(
          `Successfully updated ${result.data.successful} assignments`,
        );
        setChanges(new Map());
        await fetchData(); // Refresh data
      } else {
        throw new Error(result.message || "Failed to save assignments");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save assignments",
      );
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    const sessionToken = localStorage.getItem("adminSessionToken");
    if (!sessionToken) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch(
        "/api/v1/llm-assignments/reset-to-defaults",
        {
          method: "POST",
          headers: { "x-admin-token": sessionToken },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reset to defaults");
      }

      const result = await response.json();

      if (result.success) {
        setSuccess(
          `Successfully reset ${result.data.resetCount} features to default models`,
        );
        setChanges(new Map());
        await fetchData();
      } else {
        throw new Error(result.message || "Failed to reset to defaults");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset to defaults",
      );
    } finally {
      setSaving(false);
    }
  };

  const getEffectiveModel = (feature: AIFeature): string => {
    const pendingChange = changes.get(feature.featureKey);
    if (pendingChange) return pendingChange;

    return feature.assignedModel?.modelKey || feature.defaultModelKey || "none";
  };

  const getAvailableModelsForFeature = (feature: AIFeature): LLMModel[] => {
    const visionCapableFeatures = [
      "image_grading",
      "presentation_grading",
      "video_grading",
    ];

    const visionModels = ["gpt-4.1-mini"]; // Vision-capable models

    if (visionCapableFeatures.includes(feature.featureKey)) {
      // For vision features, show all models (including vision models)
      return models.filter((m) => m.isActive);
    } else {
      // For non-vision features, exclude vision-only models
      return models.filter(
        (m) => m.isActive && !visionModels.includes(m.modelKey),
      );
    }
  };

  const hasChanges = changes.size > 0;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">
            Loading LLM assignments...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6" />
            <h1 className="text-2xl font-bold">LLM Feature Assignments</h1>
          </div>
          <p className="text-muted-foreground">
            Manage which AI models are used for different features
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Defaults
          </Button>
          <Button onClick={saveChanges} disabled={!hasChanges || saving}>
            {saving ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Save Changes {hasChanges && `(${changes.size})`}
          </Button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Feature Assignments Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            AI Feature Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Current Model</TableHead>
                <TableHead>Assigned Model</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((feature) => {
                const effectiveModel = getEffectiveModel(feature);
                const hasChange = changes.has(feature.featureKey);
                const selectedModel = models.find(
                  (m) => m.modelKey === effectiveModel,
                );

                return (
                  <TableRow key={feature.featureKey}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{feature.displayName}</div>
                        <div className="text-sm text-muted-foreground">
                          {feature.description}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {feature.featureType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {feature.assignedModel ? (
                        <div>
                          <div className="font-medium">
                            {feature.assignedModel.displayName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {feature.assignedModel.provider} •{" "}
                            {feature.assignedModel.modelKey}
                          </div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          Default: {feature.defaultModelKey}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={effectiveModel}
                        onValueChange={(value) =>
                          handleModelChange(feature.featureKey, value)
                        }
                        disabled={!feature.isActive || saving}
                      >
                        <SelectTrigger
                          className={hasChange ? "border-orange-500" : ""}
                        >
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableModelsForFeature(feature).map(
                            (model) => (
                              <SelectItem
                                key={model.modelKey}
                                value={model.modelKey}
                              >
                                <div className="flex items-center gap-2">
                                  <span>{model.displayName}</span>
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {model.provider}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {feature.isActive ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                        {hasChange && (
                          <Badge
                            variant="outline"
                            className="text-orange-600 border-orange-500"
                          >
                            Modified
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Available Models Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Available Models</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {models.map((model) => (
              <div key={model.modelKey} className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{model.displayName}</h3>
                  <Badge variant={model.isActive ? "default" : "secondary"}>
                    {model.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground mb-2">
                  <div>
                    {model.provider} • {model.modelKey}
                  </div>
                  {model.currentPricing && (
                    <div>
                      {formatPricePerMillionTokens(
                        model.currentPricing.inputTokenPrice,
                      )}
                      /1M input tokens •{" "}
                      {formatPricePerMillionTokens(
                        model.currentPricing.outputTokenPrice,
                      )}
                      /1M output tokens
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Used by {model.assignedFeatures.length} feature
                  {model.assignedFeatures.length !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
