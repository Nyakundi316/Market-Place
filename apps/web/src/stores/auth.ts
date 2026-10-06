import type { AuthResponseDto, AuthUserDto } from '@markethub/shared';
import { create } from 'zustand';

type Status = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  /** Memory only — never persisted, so XSS can't lift it from storage. */
  accessToken: string | null;
  user: AuthUserDto | null;
  status: Status;
  setSession: (s: AuthResponseDto) => void;
  setUser: (u: AuthUserDto) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'unknown',
  setSession: ({ accessToken, user }) => set({ accessToken, user, status: 'authenticated' }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));
