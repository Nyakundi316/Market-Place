-- §3 Order.orderNumber = ORD-YYYY-NNNNNN. One global sequence keeps numbers
-- unique without a read-then-write race; the year is presentation only, so
-- the counter doesn't reset (past 999999 it simply grows a digit).
CREATE SEQUENCE "order_number_seq" START 1;

-- Stock can't go below zero even if a code path forgets to check.
ALTER TABLE "listings" ADD CONSTRAINT "listings_stock_nonnegative" CHECK ("stock" IS NULL OR "stock" >= 0);
