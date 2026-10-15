-- Phase 6: ID/business verification requests (§3 addendum).

CREATE TYPE "VerificationKind" AS ENUM ('id', 'business');
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "VerificationKind" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "documents" JSONB NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verification_requests_status_created_at_idx" ON "verification_requests"("status", "created_at");
CREATE INDEX "verification_requests_user_id_kind_idx" ON "verification_requests"("user_id", "kind");
-- At most one open request per user and kind.
CREATE UNIQUE INDEX "verification_requests_one_pending" ON "verification_requests"("user_id", "kind") WHERE "status" = 'pending';

ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reports: one open report per reporter and thing, so a button-mash doesn't flood the queue.
CREATE UNIQUE INDEX "reports_one_open_per_reporter" ON "reports"("reporter_id", "entity_type", "entity_id") WHERE "status" = 'open';
