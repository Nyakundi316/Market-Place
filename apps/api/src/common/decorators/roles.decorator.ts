import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@markethub/shared';

export const ROLES = 'roles';
/** Any listed role passes. `both` satisfies `buyer` and `seller`. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const VERIFIED = 'verified';
/** Requires a verified email, e.g. before posting a listing or paying. */
export const Verified = () => SetMetadata(VERIFIED, true);
