-- §7 webhook idempotency + seller payout destinations (§3 addendum).

CREATE TYPE "PayoutAccountStatus" AS ENUM ('pending', 'ready', 'restricted');

CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_events_gateway_event_id_key" ON "webhook_events"("gateway", "event_id");

CREATE TABLE "payout_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'pending',
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payout_accounts_user_id_gateway_key" ON "payout_accounts"("user_id", "gateway");
CREATE UNIQUE INDEX "payout_accounts_gateway_account_ref_key" ON "payout_accounts"("gateway", "account_ref");
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money rows only ever move positive amounts; direction is the txn type.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);
