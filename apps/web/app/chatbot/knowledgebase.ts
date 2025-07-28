import Fuse from "fuse.js";

export interface KnowledgeBaseItem {
  id: string;
  title: string;
  description: string;
  references?: string[];
}

export interface KnowledgeCategory {
  categoryId: string;
  categoryName: string;
  items: KnowledgeBaseItem[];
}

export const knowledgeBase: KnowledgeCategory[] = [
  {
    categoryId: "gettingStarted",
    categoryName: "Getting Started",
    items: [
      {
        id: "welcome-1",
        title: "Welcome to Mark",
        description: `Mark is an AI-driven assignment platform.
- Authors create or import assignments.
- Learners attempt assignments and receive AI grading.`,
      },
      {
        id: "create-account",
        title: "Creating an Account",
        description: `1. Go to the homepage.
2. Click "Sign Up".
3. Provide your email or use SSO.
4. Verify your email.`,
      },
    ],
  },
  {
    categoryId: "assignments",
    categoryName: "Assignment Workflows",
    items: [
      {
        id: "faq-publish",
        title: "Publishing an Assignment",
        description: `Authors finalize questions and then click "Publish" in the UI or call the publishAssignment function.`,
      },
      {
        id: "faq-regrade",
        title: "Requesting a Regrade",
        description: `Learners can request a regrade via the feedback page or by calling the requestRegrade function.`,
      },
    ],
  },
  {
    categoryId: "advancedTips",
    categoryName: "Advanced Tips & Shortcuts",
    items: [
      {
        id: "kb-shortcuts",
        title: "Shortcuts & Hidden Commands",
        description: `Use commands like '/importAssignmentData', '/exportAssignmentData', '/submitBugReport', and '/searchKnowledgeBase' in MarkChat for quick actions.`,
      },
    ],
  },
];

const allItems = knowledgeBase.flatMap((cat) => cat.items);

const fuse = new Fuse(allItems, {
  keys: ["title", "description"],
  threshold: 0.3,
});

export function searchKnowledgeBase(query: string): KnowledgeBaseItem[] {
  return fuse.search(query).map((result) => result.item);
}
