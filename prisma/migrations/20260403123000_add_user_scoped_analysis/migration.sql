-- Add per-user ownership to analyses so history and cache are scoped to the logged-in user.
ALTER TABLE "analyses"
ADD COLUMN "user_id" TEXT;

-- Existing rows are assigned to a legacy bucket to keep migration non-destructive.
UPDATE "analyses"
SET "user_id" = 'legacy-user'
WHERE "user_id" IS NULL;

ALTER TABLE "analyses"
ALTER COLUMN "user_id" SET NOT NULL;

DROP INDEX IF EXISTS "analyses_owner_repo_key";

CREATE UNIQUE INDEX "analyses_user_id_owner_repo_key"
ON "analyses"("user_id", "owner", "repo");
