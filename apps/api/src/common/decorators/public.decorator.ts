import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of the global JwtAuthGuard (wired in 1.9). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
