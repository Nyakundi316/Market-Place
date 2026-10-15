import { z } from 'zod';
import { cursorQuerySchema } from './pagination';

// ─── Reviews ────────────────────────────────────────────────────────────────

export const createReviewSchema = z
  .object({
    orderId: z.string().uuid(),
    rating: z.number().int().min(1, 'Pick 1 to 5 stars').max(5),
    comment: z.string().trim().min(3).max(1000, 'Keep it under 1000 characters').optional(),
  })
  .strict();

export const myReviewsQuerySchema = cursorQuerySchema.extend({
  role: z.enum(['given', 'received']).default('received'),
});

// ─── Reports & moderation ───────────────────────────────────────────────────

export const REPORT_ENTITIES = ['listing', 'user', 'message', 'review'] as const;
export const REPORT_REASONS = ['scam', 'prohibited', 'offensive', 'spam', 'fake', 'other'] as const;
export const REPORT_REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  scam: 'Scam or fraud',
  prohibited: 'Prohibited item or service',
  offensive: 'Offensive or abusive',
  spam: 'Spam or misleading',
  fake: 'Fake account or listing',
  other: 'Something else',
};

export const createReportSchema = z
  .object({
    entityType: z.enum(REPORT_ENTITIES),
    entityId: z.string().uuid(),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((r) => r.reason !== 'other' || (r.details && r.details.length >= 10), {
    path: ['details'],
    message: 'Tell us a bit more (10+ characters)',
  });

export const reportQuerySchema = cursorQuerySchema.extend({
  status: z.enum(['open', 'resolved', 'dismissed']).default('open'),
  entityType: z.enum(REPORT_ENTITIES).optional(),
});

/** `resolve` = acted on (usually with a removal/ban alongside); `dismiss` = nothing wrong. */
export const resolveReportSchema = z
  .object({ action: z.enum(['resolve', 'dismiss']), note: z.string().trim().max(500).optional() })
  .strict();

const moderationReason = z.string().trim().min(3, 'Give a reason').max(500);
export const removeListingSchema = z.object({ reason: moderationReason }).strict();
export const banUserSchema = z.object({ reason: moderationReason }).strict();
export const warnUserSchema = z
  .object({ message: z.string().trim().min(10, 'Say what needs to change').max(1000) })
  .strict();

export const adminUserQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  banned: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const auditQuerySchema = cursorQuerySchema.extend({
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().trim().max(60).optional(),
});

// ─── Verification ───────────────────────────────────────────────────────────

/** E.164: "+254712345678". */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use the international format, e.g. +254712345678'));

export const sendPhoneCodeSchema = z.object({ phone: phoneSchema }).strict();
export const verifyPhoneSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code'),
  })
  .strict();

export const VERIFICATION_KINDS = ['id', 'business'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export const ID_DOCUMENT_TYPES = ['national_id', 'passport', 'driving_licence'] as const;

/** Keys returned by POST /images/sign with purpose `verification`. */
const documentKeys = z.array(z.string().max(200)).min(1, 'Add a photo of the document').max(4);

export const createVerificationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('id'),
      documents: documentKeys,
      details: z.object({ documentType: z.enum(ID_DOCUMENT_TYPES) }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('business'),
      documents: documentKeys,
      details: z
        .object({
          businessName: z.string().trim().min(2).max(120),
          registrationNumber: z.string().trim().min(3).max(60),
        })
        .strict(),
    })
    .strict(),
]);

export const verificationQuerySchema = cursorQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});

export const reviewVerificationSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'approve' || (v.note && v.note.length >= 5), {
    path: ['note'],
    message: 'Tell the user why, so they can fix it',
  });

// ─── Analytics ──────────────────────────────────────────────────────────────

export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(30),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type MyReviewsQuery = z.infer<typeof myReviewsQuerySchema>;
export type ReportEntity = (typeof REPORT_ENTITIES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type CreateVerificationInput = z.infer<typeof createVerificationSchema>;
export type VerificationQuery = z.infer<typeof verificationQuerySchema>;
export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
