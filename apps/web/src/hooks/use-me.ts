import type { MeDto } from '@markethub/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export const meKey = ['me'] as const;

export function useMe() {
  const status = useAuth((s) => s.status);
  return useQuery({
    queryKey: meKey,
    queryFn: () => api<MeDto>('/me'),
    enabled: status === 'authenticated',
  });
}
