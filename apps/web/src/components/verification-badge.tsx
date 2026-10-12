import { BadgeCheck, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shows only what was actually verified (§0: no fake trust signals).
 * `compact` renders just the icon, with the label for screen readers.
 */
export function VerificationBadge({
  idVerified,
  businessVerified,
  compact = false,
  className,
}: {
  idVerified: boolean;
  businessVerified: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!idVerified && !businessVerified) return null;
  const label = businessVerified ? 'Verified business' : 'ID verified';
  const Icon = businessVerified ? Building2 : BadgeCheck;
  return (
    <span
      title={label}
      className={cn('inline-flex items-center gap-1 text-xs font-medium text-verified', className)}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
