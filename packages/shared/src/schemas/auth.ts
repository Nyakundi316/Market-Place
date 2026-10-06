import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// Upper bound keeps argon2 input sane; no composition rules (NIST 800-63B).
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['buyer', 'seller', 'both']).default('buyer'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const token = z.string().min(32).max(256);

export const verifyEmailSchema = z.object({ token });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token, password: passwordSchema });

export const oauthProviderSchema = z.enum(['google', 'github']);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;
