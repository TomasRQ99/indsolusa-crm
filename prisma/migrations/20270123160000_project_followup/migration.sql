-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "dealId" TEXT;

-- AlterTable
ALTER TABLE "ProjectPost" ADD COLUMN     "decision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "projectAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "projectAsks" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ProjectPostFile" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPostFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMention" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueOn" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectNudge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemId" TEXT,
    "dateId" TEXT,
    "toUserId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "answer" TEXT,
    "note" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectNudge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "objective" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" TEXT NOT NULL DEFAULT 'MEDIA',
    "items" JSONB NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectPostFile_postId_idx" ON "ProjectPostFile"("postId");

-- CreateIndex
CREATE INDEX "ProjectMention_userId_seenAt_idx" ON "ProjectMention"("userId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMention_postId_userId_key" ON "ProjectMention"("postId", "userId");

-- CreateIndex
CREATE INDEX "ProjectItem_projectId_stage_idx" ON "ProjectItem"("projectId", "stage");

-- CreateIndex
CREATE INDEX "ProjectItem_ownerId_doneAt_idx" ON "ProjectItem"("ownerId", "doneAt");

-- CreateIndex
CREATE INDEX "ProjectNudge_toUserId_answeredAt_idx" ON "ProjectNudge"("toUserId", "answeredAt");

-- CreateIndex
CREATE INDEX "ProjectNudge_projectId_idx" ON "ProjectNudge"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_name_key" ON "ProjectTemplate"("name");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPostFile" ADD CONSTRAINT "ProjectPostFile_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ProjectPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMention" ADD CONSTRAINT "ProjectMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ProjectPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMention" ADD CONSTRAINT "ProjectMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectItem" ADD CONSTRAINT "ProjectItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectItem" ADD CONSTRAINT "ProjectItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNudge" ADD CONSTRAINT "ProjectNudge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNudge" ADD CONSTRAINT "ProjectNudge_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProjectItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNudge" ADD CONSTRAINT "ProjectNudge_dateId_fkey" FOREIGN KEY ("dateId") REFERENCES "ProjectDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNudge" ADD CONSTRAINT "ProjectNudge_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
