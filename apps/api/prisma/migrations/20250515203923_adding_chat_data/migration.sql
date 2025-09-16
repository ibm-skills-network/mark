-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- AlterTable
ALTER TABLE "AIUsage" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "assignmentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toolCalls" JSONB,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ChatToUserCredential" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Chat_userId_startedAt_idx" ON "Chat"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Chat_assignmentId_idx" ON "Chat"("assignmentId");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_timestamp_idx" ON "ChatMessage"("chatId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "_ChatToUserCredential_AB_unique" ON "_ChatToUserCredential"("A", "B");

-- CreateIndex
CREATE INDEX "_ChatToUserCredential_B_index" ON "_ChatToUserCredential"("B");

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserCredential"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatToUserCredential" ADD CONSTRAINT "_ChatToUserCredential_A_fkey" FOREIGN KEY ("A") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatToUserCredential" ADD CONSTRAINT "_ChatToUserCredential_B_fkey" FOREIGN KEY ("B") REFERENCES "UserCredential"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
