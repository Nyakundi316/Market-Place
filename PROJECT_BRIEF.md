# MarketHub — Build Brief
Role: lead full-stack eng. Build marketplace: users post products/services by category, real-time chat, negotiate offers, pay via escrow. Follow brief exactly. Ask only if blocked; else use defaults here.

## 0. Rules
- Trust: verification badges, reviews, escrow; no fake data in prod
- Security: JWT every req, authz every mutation, rate limits, idempotency keys on money ops
- Postgres = truth; Redis = cache/pubsub only
- Never trust client for money/identity; webhooks + server checks only
- Mobile-first (375px)
- TS strict; no `any` unless commented
- Every endpoint: ≥1 happy + 1 sad test
- Schema changes via Prisma migrations only
- No secrets in code; .env + zod validation at boot
- All lists cursor-paginated, max 50

## 1. Stack (no deviation w/o asking)
Web: Next.js 14 App Router, TS, Tailwind, shadcn/ui, Zustand, React Query, RHF+Zod
API: NestJS, Prisma, Postgres 16, Redis 7, Socket.IO + redis-adapter, BullMQ
Auth: JWT (access 15m, refresh 7d) + OAuth Google/GitHub
Infra: S3-compatible (R2/S3), Stripe + Paystack (adapter), Resend, FCM, Postgres FTS→Meilisearch later
Tooling: pnpm workspaces + Turborepo, Docker compose, GitHub Actions

## 2. Repo
```
apps/{web,api}  packages/{shared,ui,config}
infra/{docker-compose.yml,Dockerfile.api,Dockerfile.web,k8s/}
.github/workflows  PROJECT_BRIEF.md  turbo.json  pnpm-workspace.yaml  README.md
```

## 3. Schema (apps/api/prisma/schema.prisma — extra fields only if documented)
Enums:
- UserRole: seller|buyer|both|admin
- ListingType: product|service|job|request
- ListingStatus: draft|pending|active|sold|expired|removed
- MessageType: text|image|file|system|offer|offer_response
- OfferStatus: pending|accepted|declined|countered|expired|withdrawn
- OrderStatus: awaiting_payment|paid|in_escrow|shipped|delivered|completed|disputed|refunded|cancelled
- EscrowStatus: held|released|refunded|partially_refunded|disputed
- TxnType: charge|payout|refund|fee|chargeback
- TxnStatus: pending|succeeded|failed|reversed

Models (all have timestamps unless noted; ids uuid):
- User: email(unique citext), phone, passwordHash, role, isEmailVerified, isPhoneVerified, isActive, isBanned, lastLoginAt
- OAuthAccount: userId, provider, providerUid, tokens; uniq(provider,providerUid)
- Profile: userId PK/FK, displayName, username(uniq), avatarUrl, coverUrl, bio, profession, company, website, country, city, socials Json, idVerified, businessVerified, ratingAvg, ratingCount, listingsCount, completedDeals, responseRate
- Category: parentId(self), name, slug(uniq), icon, description, sortOrder, isActive
- Tag: name(uniq), slug(uniq), useCount
- Listing: sellerId, categoryId, type, status, title, slug(uniq), description, price, currency, isNegotiable, isPriceRange, priceMin, priceMax, stock, condition, country, city, lat, lng, contactPref, viewsCount, favoritesCount, chatCount, isFeatured, featuredUntil, publishedAt, expiresAt, searchVector tsvector
- ListingImage: listingId, url, thumbUrl, sortOrder
- ListingTag: PK(listingId,tagId)
- Conversation: listingId, buyerId, sellerId, lastMessageAt, lastMessageId, buyerUnread, sellerUnread, isArchived; uniq(listingId,buyerId,sellerId)
- Message: conversationId, senderId, type, body, attachments Json, offerId, isRead, readAt, createdAt
- Offer: conversationId, listingId, fromUserId, toUserId, parentOfferId, quantity, unitPrice, totalPrice, currency, message, status, expiresAt, respondedAt, createdAt
- Order: orderNumber(uniq, ORD-YYYY-NNNNNN), listingId, offerId, buyerId, sellerId, quantity, unitPrice, subtotal, platformFee, total, currency, status, deliveryMethod, deliveryAddress Json, trackingNumber, notes, paidAt, deliveredAt, completedAt, cancelledAt
- EscrowHold: orderId(uniq), amount, currency, status, heldAt, releaseScheduledAt, releasedAt, refundedAt, disputeReason, notes
- Transaction: orderId, userId, type, status, amount, currency, gateway, gatewayRef, gatewayPayload Json, idempotencyKey(uniq), createdAt
- Review: orderId(uniq), raterId, rateeId, rating 1–5, comment, isVisible, createdAt; CHECK rater≠ratee
- Follow: PK(followerId,followingId)
- Favorite: PK(userId,listingId)
- Notification: userId, type, title, body, link, payload Json, isRead, readAt
- AuditLog: actorId, action, entityType, entityId, metadata Json, ipAddress
- Report: reporterId, entityType, entityId, reason, details, status, resolvedBy, resolvedAt

Triggers (raw SQL migrations):
1. listings_search_vector: BEFORE INS/UPD; title=A, description=B
2. refresh_profile_rating: AFTER INS/UPD/DEL reviews → profile ratingAvg/Count
3. update_conversation_on_message: AFTER INS messages → lastMessageAt, unread++

Indexes:
- users: email; role partial WHERE is_active
- listings: sellerId; categoryId WHERE status='active'; status; price; (country,city); GIN searchVector; GIN title gin_trgm_ops
- profiles: username, country
- conversations: (buyerId,lastMessageAt DESC), (sellerId,lastMessageAt DESC)
- messages: (conversationId,createdAt DESC)
- notifications: (userId,isRead,createdAt DESC)
- transactions: orderId, gatewayRef, idempotencyKey uniq
- audit_logs: (entityType,entityId), (actorId,createdAt DESC)

## 4. API (NestJS, apps/api/src)
```
main.ts app.module.ts
common/{guards(JwtAuth,Roles,Verified),interceptors(Logging,Transform),filters(Http,Prisma),decorators(@CurrentUser,@Roles,@Public),pipes(ZodValidation),middleware(RateLimit)}
config/env.validation.ts
modules/{auth,users,categories,listings,images,chat,offers,orders,payments,escrow,reviews,notifications,admin,audit}
prisma/{schema.prisma,migrations,seed.ts}
```
Every endpoint: Zod input from packages/shared; DTOs from packages/shared/types; guard unless @Public; 100 req/min/user (Redis token bucket); audit if mutates money/user state.

Endpoints (implement all):
- Auth: POST register|login|refresh|logout|verify-email|forgot-password|reset-password; GET oauth/:provider, oauth/:provider/callback
- Profile: GET/PATCH /me; POST /me/avatar; GET /users/:username; POST|DELETE /users/:id/follow; GET /users/:id/reviews
- Categories: GET / (tree), GET /:slug; POST, PATCH /:id, DELETE /:id (admin)
- Listings: GET / (q,categoryId,minPrice,maxPrice,country,city,rating,verified,sort,cursor,limit); GET /:slug; GET /mine; POST; PATCH|DELETE /:id; POST /:id/publish|boost; POST|DELETE /:id/favorite
- Images: POST /images/sign (presigned PUT)
- Chat: GET /conversations, /conversations/:id, /conversations/:id/messages (cursor); POST /conversations (find-or-create by listingId), /messages, /conversations/:id/read
- Offers: POST /offers; POST /offers/:id/counter|accept|decline|withdraw; GET /offers/mine
- Orders: POST /orders (from accepted offer); GET /orders, /orders/:id; POST /orders/:id/pay|ship|deliver|confirm-delivery|dispute|cancel
- Webhooks: POST /webhooks/stripe, /webhooks/paystack
- Reviews: POST /reviews; GET /reviews/mine
- Notifications: GET /notifications; POST /notifications/read-all, /notifications/:id/read
- Admin: GET /admin/reports; POST /admin/reports/:id/resolve, /admin/listings/:id/remove, /admin/users/:id/ban, /admin/verify/:userId

## 5. Chat (chat.gateway.ts)
- JWT in io.use() handshake; reject invalid
- Connect: join `user:{uid}`; SET presence:{uid}=online TTL 60s; join `conv:{id}` for each conversation; emit presence:update
- Disconnect: DEL presence, emit offline
- Redis adapter for multi-instance
- Events: message:send C→S {conversationId,body,type,attachments}; message:new S→C Message; message:read both {conversationId,upTo[,byUser]}; typing both {conversationId,isTyping}; presence:update {userId,status}; offer:new|offer:update Offer; notification:new
- Persist to Postgres, then broadcast
- Authz every event (sender ∈ conversation)
- Rate limit 20 msg/10s (INCR+EXPIRE)
- No presence → enqueue notify:offline
- Store raw, escape on render
- Client ping:presence every 30s refreshes TTL

## 6. Web (Next.js)
Routes: / , /login, /signup, /onboarding (3-step), /(app)/{feed, search, c/[slug], l/[slug], create, chat, chat/[id], deals, orders/[id], seller, u/[username], settings}, /admin (role=admin)
Components: ListingCard/Grid/Filters, CategoryTree/Chips, ChatBubble/Composer, TypingIndicator, PresenceDot, OfferCard, CounterOfferModal, CheckoutSummary, PaymentForm (Stripe Elements), OrderTimeline, ReviewStars/Form, VerificationBadge, ProfileAvatar, NotificationBell/List, BottomNav (mobile), Sidebar (desktop), CreatePostWizard (5 steps)
UX: sticky mobile CTA [Chat][Make Offer] on listing; optimistic chat/favourite/follow; skeletons on every fetch; sonner toasts; money via Intl.NumberFormat w/ data currency; WCAG AA, keyboard chat nav, modal focus traps

## 7. Payments & Escrow
```ts
interface PaymentProvider {
  charge(p: ChargeParams): Promise<ChargeResult>;
  capture(ref: string): Promise<void>;
  refund(ref: string, amount: number): Promise<RefundResult>;
  transfer(p: TransferParams): Promise<TransferResult>;
  verifyWebhook(raw: Buffer, sig: string): WebhookEvent;
}
```
Impls: StripeProvider, PaystackProvider.

Charge (POST /orders/:id/pay w/ payment token):
1. Verify buyer owns order & status=awaiting_payment
2. Fee = PLATFORM_FEE_PERCENT (default 2)
3. Idempotency key `order:{id}:charge`; if succeeded txn exists → return
4. Insert txn pending
5. Gateway charge (authorise-only/manual capture where supported)
6. Success: txn succeeded, EscrowHold held, order in_escrow, paidAt
7. Notify seller; return client_secret if 3DS

Release: on confirm-delivery or 72h after delivered → BullMQ release-escrow → transfer net to seller connected account → escrow released, payout txn, order completed, notify both.

Dispute: buyer ≤7 days after delivery → order+escrow disputed → admin resolves (full/partial refund or release). Never delete txns; insert refund/reversal rows.

Webhooks: verify sig (Stripe constructEvent; Paystack HMAC-SHA512); event id as idempotency key, INSERT … ON CONFLICT DO NOTHING; only webhooks move awaiting_payment→paid.

Must: no raw PAN (Elements/hosted fields); HTTPS+HSTS+secure cookies; payment rate 5/min/user; 3DS/SCA via gateway; Stripe Connect KYC above payout threshold; nightly reconciliation vs gateway ledger, alert on mismatch.

## 8. Jobs (BullMQ)
notify:offline, payout:release, payout:auto-release (delayed delivery+72h), listing:expire, listing:search-index (later), email:send, push:send, reconcile:payments (nightly), audit:cleanup.
All idempotent, exponential backoff max 5, DLQ.

## 9. Security
- JWT secret ≥32 chars, rotate 90d
- Refresh tokens hashed, single-use, rotated
- argon2id (64MB, t=3, p=4)
- CSRF double-submit for cookie routes; Helmet; CORS = web origin only
- Zod on every DTO; Prisma only, no string-concat SQL
- DOMPurify on render
- Uploads: jpeg/png/webp/mp4, ≤20MB, optional ClamAV
- Rate limits: global 100/min, auth 10/min, payment 5/min, messages 20/10s
- Audit all admin actions + money state changes
- Reports: user create, admin resolve
- Banned users can't log in/post
- Public DTOs never expose passwordHash, gatewayPayload, internal ids

## 10. Phases (in order)
1 Foundation: monorepo; compose (postgres, redis, mailhog); Nest scaffold + env validation + logger + filters; Prisma schema + migration + seed (categories, admin); auth (register/login/refresh/guards/roles); OAuth; Next scaffold + Tailwind + shadcn + shell; auth pages; onboarding; auth+profile E2E
2 Listings: category tree API+UI; listing CRUD + publish; presigned upload; FTS+trigram search; feed/category/detail pages; create wizard; favourites/follow; E2E
3 Chat: gateway + adapter; models wired; REST fallback; chat UI; typing/presence/receipts; offline worker; gateway integration tests
4 Offers & Orders: offer state machine; order from offer; deals dashboard; tracking page; notifications (in-app/email/push); tests
5 Payments & Escrow: interface + Stripe; Paystack; checkout + Elements; charge + hold; webhooks; release + auto-release; refund/dispute; reconciliation; tests (charge, webhook replay, refund, payout)
6 Trust: reviews + trigger; verification (email/phone/ID/business); reports + admin panel; moderation UI; ban/warn; audit viewer; seller analytics
7 Launch: SEO (metadata, sitemap, structured data); PWA; i18n scaffold (EN); k6 on listings+chat; Sentry + OTel; deploy (Fly/Railway/ECS); runbook

## 11. Done = all of
Tests happy/sad/authz per endpoint; responsive 375/768/1280; 0 TS errors, 0 ESLint warnings; 0 browser console errors; money idempotency verified; admin actions audited; README updated (endpoints, env); seed covers new models; compose boots clean; `pnpm test` + `pnpm test:e2e` pass in CI.

## 12. Env (zod-validated)
```
NODE_ENV PORT=3001 WEB_URL API_URL DATABASE_URL REDIS_URL
JWT_ACCESS_SECRET JWT_REFRESH_SECRET JWT_ACCESS_TTL=15m JWT_REFRESH_TTL=7d
GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY S3_REGION
STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_CONNECT_CLIENT_ID
PAYSTACK_SECRET_KEY PAYSTACK_WEBHOOK_SECRET RESEND_API_KEY FCM_SERVER_KEY
PLATFORM_FEE_PERCENT=2 ESCROW_AUTO_RELEASE_HOURS=72 DISPUTE_WINDOW_DAYS=7
```

## 13. Working conventions
- Each phase: print task list, wait for "go"
- One concern per commit, Conventional Commits
- 2–3 line plan before code; show diffs, never silent full rewrites
- Justify any new dep before adding
- Cite brief sections (e.g. "per §5")
- No placeholders in money/auth code
- Tests alongside code
- Blocked on business logic → stop and ask
- End session: update PROGRESS.md (shipped / in progress / next / blockers)

## 14. "start Phase 1"
1. Print Phase 1 checklist  2. Show scaffold shell commands  3. Wait for confirmation  4. Execute one sub-step at a time, running tests. Split any sub-step >~150 LOC.

## §3 Addendum — documented extras (approved 2026-10-06)
- **RefreshToken**: userId, tokenHash(uniq), familyId, expiresAt, usedAt, revokedAt, userAgent, ipAddress. Backs §9 single-use rotation; reuse of a used token revokes the family.
- **AuthToken**: userId, type (enum AuthTokenType: email_verify|password_reset), tokenHash(uniq), expiresAt, usedAt. Backs verify-email / reset-password links.
- `User.passwordHash` is nullable for OAuth-only accounts.
- Join tables (Follow, Favorite, ListingTag) carry `createdAt` only.
- Money columns are `Decimal(14,2)`; currency `Char(3)` ISO 4217; country `Char(2)` ISO 3166-1.
- `Order.offerId` is unique: one accepted offer yields at most one order.
- `Conversation.lastMessageId` is a plain uuid column (no FK) to avoid a Conversation↔Message cycle; maintained by trigger.
- `Transaction.updatedAt` added: status moves pending→succeeded/failed; rows are still never deleted.
- AuditLog is append-only (createdAt only); `actorId` null means a system/job action.
- §4/§9 rate limiting is a global **guard** (`common/rate-limit/`), not middleware: per-user buckets need `req.user`, which only exists after JwtAuthGuard. Anonymous calls are keyed by IP; auth routes always by IP. Redis outage → fail open, except `payment` which fails closed.
