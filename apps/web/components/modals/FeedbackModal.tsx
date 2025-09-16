"use client";

import { Star, MessageSquare, User, Calendar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Feedback {
  id: number;
  userId: string;
  assignmentRating: number | null;
  aiGradingRating: number | null;
  aiFeedbackRating?: number | null;
  comments: string | null;
  createdAt: string;
}

interface FeedbackModalProps {
  feedback: Feedback | null;
  isOpen: boolean;
  onClose: () => void;
}

const StarRating = ({
  rating,
  label,
}: {
  rating: number | null;
  label: string;
}) => {
  if (!rating) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {label}:
        </span>
        <Badge variant="secondary">No rating</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">
        {label}:
      </span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? "text-yellow-500 fill-current" : "text-gray-300"
            }`}
          />
        ))}
        <span className="ml-1 text-sm font-medium">{rating}/5</span>
      </div>
    </div>
  );
};

export function FeedbackModal({
  feedback,
  isOpen,
  onClose,
}: FeedbackModalProps) {
  if (!feedback) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feedback Details
          </DialogTitle>
          <DialogDescription>
            Detailed view of user feedback submission
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* User Information */}
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">User ID:</span>
            <code className="text-sm bg-muted px-2 py-1 rounded">
              {feedback.userId}
            </code>
          </div>

          {/* Submission Date */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Submitted:</span>
            <span className="text-sm">{formatDate(feedback.createdAt)}</span>
          </div>

          <Separator />

          {/* Ratings Section */}
          <div className="space-y-4">
            <h4 className="font-medium">Ratings</h4>
            <div className="space-y-3">
              <StarRating
                rating={feedback.assignmentRating}
                label="Assignment Rating"
              />
              <StarRating
                rating={feedback.aiGradingRating}
                label="AI Grading Rating"
              />
              <StarRating
                rating={feedback?.aiFeedbackRating}
                label="AI Feedback Rating"
              />
            </div>
          </div>

          <Separator />

          {/* Comments Section */}
          <div className="space-y-3">
            <h4 className="font-medium">Comments</h4>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap">
                {feedback.comments || "No comments provided"}
              </p>
            </div>
          </div>

          {/* Metadata */}
          <Separator />
          <div className="text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Feedback ID: {feedback.id}</span>
              <span>Submitted: {formatDate(feedback.createdAt)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
