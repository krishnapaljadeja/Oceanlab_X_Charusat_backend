-- CreateTable
CREATE TABLE "analyses" (
    "id" SERIAL NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commit_count" INTEGER NOT NULL,
    "repo_meta" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "narrative" JSONB NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analyses_owner_repo_key" ON "analyses"("owner", "repo");
