'use client';

import {
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  type ReportEntity,
  type ReportReason,
} from '@markethub/shared';
import { Flag, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useReport } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

const NOUN: Record<ReportEntity, string> = {
  listing: 'listing',
  user: 'user',
  message: 'message',
  review: 'review',
};

/** A quiet "Report" link that opens a short form; signed-in users only. */
export function ReportButton({
  entityType,
  entityId,
  className,
  compact = false,
}: {
  entityType: ReportEntity;
  entityId: string;
  className?: string;
  /** Icon only, for tight headers. */
  compact?: boolean;
}) {
  const authed = useAuth((s) => s.status === 'authenticated');
  const report = useReport();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  if (!authed) return null;

  const needsDetails = reason === 'other' && details.trim().length < 10;
  const submit = () =>
    reason &&
    report.mutate(
      { entityType, entityId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Thanks — our team will take a look');
          setOpen(false);
          setReason(null);
          setDetails('');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            toast(err.message);
            setOpen(false);
          } else toast.error(err instanceof ApiError ? err.message : 'Couldn’t send the report');
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={compact ? `Report ${NOUN[entityType]}` : undefined}
          title={compact ? `Report ${NOUN[entityType]}` : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive',
            className,
          )}
        >
          <Flag className={compact ? 'size-4' : 'size-3.5'} aria-hidden />
          {!compact && `Report ${NOUN[entityType]}`}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this {NOUN[entityType]}</DialogTitle>
          <DialogDescription>
            Reports are private. The other person isn&apos;t told who sent it.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-1.5">
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring',
                reason === r ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
              )}
            >
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-primary"
              />
              {REPORT_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="report-details">
            Details{' '}
            <span className="font-normal text-muted-foreground">
              {reason === 'other' ? '(required)' : '(optional)'}
            </span>
          </Label>
          <Textarea
            id="report-details"
            rows={3}
            maxLength={1000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || needsDetails || report.isPending}
            onClick={submit}
          >
            {report.isPending && <Loader2 className="size-4 animate-spin" />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
