'use client';

import type {
  AdminOverviewDto,
  CreateReportInput,
  CreateReviewInput,
  CreateVerificationInput,
  CursorPage,
  ResolveDisputeInput,
  ResolveReportInput,
  ReviewVerificationInput,
  SellerAnalyticsDto,
  VerificationStatusDto,
} from '@markethub/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { dealKeys } from './use-deals';

const useAuthed = () => useAuth((s) => s.status === 'authenticated');

// ─── Reviews & reports ───────────────────────────────────────────────────

export function useCreateReview(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateReviewInput, 'orderId'>) =>
      api('/reviews', { method: 'POST', body: { orderId, ...input } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dealKeys.order(orderId) }),
  });
}

export function useReport() {
  return useMutation({
    mutationFn: (input: CreateReportInput) => api('/reports', { method: 'POST', body: input }),
  });
}

// ─── Verification ────────────────────────────────────────────────────────

export const verificationKey = ['verification'] as const;

export function useVerification() {
  const authed = useAuthed();
  return useQuery({
    queryKey: verificationKey,
    queryFn: () => api<VerificationStatusDto>('/me/verification'),
    enabled: authed,
  });
}

export function usePhoneCode() {
  return useMutation({
    mutationFn: (phone: string) =>
      api<{ sent: boolean; expiresIn: number }>('/me/phone/send-code', {
        method: 'POST',
        body: { phone },
      }),
  });
}

export function useVerifyPhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<VerificationStatusDto>('/me/phone/verify', { method: 'POST', body: { code } }),
    onSuccess: (status) => qc.setQueryData(verificationKey, status),
  });
}

export function useRequestVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVerificationInput) =>
      api<VerificationStatusDto>('/me/verification', { method: 'POST', body: input }),
    onSuccess: (status) => qc.setQueryData(verificationKey, status),
  });
}

// ─── Seller analytics ────────────────────────────────────────────────────

export function useSellerAnalytics(days: 7 | 30 | 90) {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api<SellerAnalyticsDto>(`/me/analytics?days=${days}`),
    enabled: authed,
    placeholderData: (prev) => prev, // keep the tiles while switching period
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────

export const adminKeys = {
  all: ['admin'] as const,
  overview: ['admin', 'overview'] as const,
  list: (what: string, params: string) => ['admin', what, params] as const,
};

/** One cursor-paged admin list: `/admin/{path}?{params}`. */
export function useAdminList<T>(path: string, params = '') {
  const authed = useAuthed();
  return useInfiniteQuery({
    queryKey: adminKeys.list(path, params),
    queryFn: ({ pageParam }) =>
      api<CursorPage<T>>(
        `/admin/${path}?limit=20${params ? `&${params}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
}

export function useAdminOverview() {
  const authed = useAuthed();
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: () => api<AdminOverviewDto>('/admin/overview'),
    enabled: authed,
  });
}

type AdminAction =
  | { kind: 'resolve-report'; id: string; body: ResolveReportInput }
  | { kind: 'remove-listing'; id: string; reason: string }
  | { kind: 'hide-review'; id: string; reason: string }
  | { kind: 'warn'; id: string; message: string }
  | { kind: 'ban' | 'unban'; id: string; reason: string }
  | { kind: 'verify'; userId: string; body: ReviewVerificationInput }
  | { kind: 'resolve-dispute'; orderId: string; body: ResolveDisputeInput };

const adminRequest = (a: AdminAction): [string, unknown] => {
  switch (a.kind) {
    case 'resolve-report':
      return [`/admin/reports/${a.id}/resolve`, a.body];
    case 'remove-listing':
      return [`/admin/listings/${a.id}/remove`, { reason: a.reason }];
    case 'hide-review':
      return [`/admin/reviews/${a.id}/hide`, { reason: a.reason }];
    case 'warn':
      return [`/admin/users/${a.id}/warn`, { message: a.message }];
    case 'ban':
    case 'unban':
      return [`/admin/users/${a.id}/${a.kind}`, { reason: a.reason }];
    case 'verify':
      return [`/admin/verify/${a.userId}`, a.body];
    case 'resolve-dispute':
      return [`/admin/disputes/${a.orderId}/resolve`, a.body];
  }
};

/** Every admin action refreshes every admin view: the queues are small. */
export function useAdminAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: AdminAction) => {
      const [path, body] = adminRequest(a);
      return api(path, { method: 'POST', body });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.all }),
  });
}
