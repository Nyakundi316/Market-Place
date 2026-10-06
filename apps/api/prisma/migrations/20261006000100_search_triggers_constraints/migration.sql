-- §3 pieces Prisma can't model: partial/GIN indexes, CHECKs, triggers.

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX "users_role_active_idx" ON "users" ("role") WHERE "is_active";

CREATE INDEX "listings_category_active_idx" ON "listings" ("category_id") WHERE "status" = 'active';

CREATE INDEX "listings_search_vector_idx" ON "listings" USING GIN ("search_vector");

-- ─── Constraints ────────────────────────────────────────────────────────────

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_rater_not_ratee" CHECK ("rater_id" <> "ratee_id");

-- Money is never negative; refunds are their own rows with type=refund (§7).
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonneg"
  CHECK ("subtotal" >= 0 AND "platform_fee" >= 0 AND "total" >= 0 AND "quantity" > 0);
ALTER TABLE "offers" ADD CONSTRAINT "offers_amounts_positive"
  CHECK ("unit_price" > 0 AND "total_price" > 0 AND "quantity" > 0);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyer_not_seller" CHECK ("buyer_id" <> "seller_id");
ALTER TABLE "follows" ADD CONSTRAINT "follows_not_self" CHECK ("follower_id" <> "following_id");

-- ─── 1. listings_search_vector ──────────────────────────────────────────────

CREATE FUNCTION listings_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END $$;

CREATE TRIGGER listings_search_vector
  BEFORE INSERT OR UPDATE OF "title", "description" ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listings_search_vector();

-- ─── 2. refresh_profile_rating ──────────────────────────────────────────────
-- Only visible reviews count, so hiding a review (moderation) updates the average.

CREATE FUNCTION refresh_profile_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected uuid;
BEGIN
  FOR affected IN
    SELECT DISTINCT r FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.ratee_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.ratee_id END
    ]) AS r WHERE r IS NOT NULL
  LOOP
    UPDATE "profiles" p SET
      "rating_avg"   = coalesce(s.avg, 0),
      "rating_count" = s.cnt,
      "updated_at"   = now()
    FROM (
      SELECT round(avg("rating")::numeric, 2) AS avg, count(*)::int AS cnt
      FROM "reviews" WHERE "ratee_id" = affected AND "is_visible"
    ) s
    WHERE p."user_id" = affected;
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER refresh_profile_rating
  AFTER INSERT OR UPDATE OR DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION refresh_profile_rating();

-- ─── 3. update_conversation_on_message ──────────────────────────────────────
-- The recipient's unread counter goes up; system messages (sender is neither
-- party) bump both.

CREATE FUNCTION update_conversation_on_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "conversations" SET
    "last_message_at" = NEW.created_at,
    "last_message_id" = NEW.id,
    "buyer_unread"    = "buyer_unread"  + CASE WHEN NEW.sender_id = "buyer_id"  THEN 0 ELSE 1 END,
    "seller_unread"   = "seller_unread" + CASE WHEN NEW.sender_id = "seller_id" THEN 0 ELSE 1 END,
    "is_archived"     = false,
    "updated_at"      = now()
  WHERE "id" = NEW.conversation_id;
  RETURN NULL;
END $$;

CREATE TRIGGER update_conversation_on_message
  AFTER INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();
