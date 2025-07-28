import { SetMetadata } from "@nestjs/common";

export const ALLOW_PUBLIC_ACCESS = "allowPublicAccess";
export const ALLOW_ADMIN_ONLY = "allowAdminOnly";
export const SKIP_ASSIGNMENT_CHECK = "skipAssignmentCheck";

export const PublicChatAccess = () => SetMetadata(ALLOW_PUBLIC_ACCESS, true);
export const AdminOnlyChatAccess = () => SetMetadata(ALLOW_ADMIN_ONLY, true);
export const SkipAssignmentCheck = () =>
  SetMetadata(SKIP_ASSIGNMENT_CHECK, true);
