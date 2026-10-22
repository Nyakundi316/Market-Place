'use client';

import type { ConversationDto, MessageDto, OfferDto } from '@markethub/shared';
import { ArrowRight, Clock, Handshake } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isBuyerIn, useOfferAction } from '@/hooks/use-deals';
import { ApiError } from '@/lib/api';
import { formatMoney, messageTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StatusPill } from './status-pill';

/** §6 OfferCard: the offer as it stands now, with whatever the viewer can do about it. */
export function OfferCard({
  offer,
  message,
  me,
  conversation,
  onCounter,
  onCheckout,
}: {
  offer: OfferDto | undefined;
  message: MessageDto;
  me: string | undefined;
  conversation: ConversationDto | undefined;
  onCounter: (offer: OfferDto) => void;
  onCheckout: (offer: OfferDto) => void;
}) {
  const action = useOfferAction();
  const mine = message.senderId === me;

  if (!offer || !conversation) {
    return (
      <div className={cn('mt-3 flex', mine ? 'justify-end' : 'justify-start')}>
        <Skeleton className="h-28 w-64 rounded-2xl" />
      </div>
    );
  }

  const live =
    offer.status === 'pending' && (!offer.expiresAt || Date.parse(offer.expiresAt) > Date.now());
  const forMe = offer.toUserId === me;
  const iBuy = isBuyerIn(conversation);
  const run = (kind: 'accept' | 'decline' | 'withdraw') =>
    action.mutate(
      { kind, id: offer.id },
      {
        onSuccess: () => {
          if (kind === 'accept')
            toast.success(iBuy ? 'Accepted — check out when ready' : 'Offer accepted');
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Try again'),
      },
    );

  return (
    <div className={cn('mt-3 flex', mine ? 'justify-end' : 'justify-start')}>
      <article
        aria-label={`${mine ? 'Your' : 'Their'} offer`}
        className={cn(
          'w-72 max-w-[85%] overflow-hidden rounded-2xl border bg-card shadow-card',
          mine ? 'rounded-br-md' : 'rounded-bl-md',
          live && forMe && 'border-primary/50 ring-1 ring-primary/20',
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <Handshake className="size-3.5" aria-hidden />
            {offer.parentOfferId ? 'Counter-offer' : 'Offer'}
          </span>
          <StatusPill status={offer.status} kind="offer" />
        </header>

        <div className="px-3.5 pb-3 pt-2.5">
          <p
            className={cn(
              'tabular font-display text-[1.65rem] font-semibold leading-tight tracking-tight',
              !live &&
                offer.status !== 'accepted' &&
                'text-muted-foreground line-through decoration-1',
            )}
          >
            {formatMoney(offer.totalPrice, offer.currency)}
          </p>
          {offer.quantity > 1 && (
            <p className="tabular text-xs text-muted-foreground">
              {offer.quantity} × {formatMoney(offer.unitPrice, offer.currency)}
            </p>
          )}
          {offer.message && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{offer.message}</p>
          )}
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            {live && offer.expiresAt ? (
              <>
                <Clock className="size-3" aria-hidden /> Expires {timeAgo(offer.expiresAt)}
              </>
            ) : (
              messageTime(message.createdAt)
            )}
          </p>
        </div>

        {live && forMe && (
          <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 border-t p-2">
            <Button size="sm" disabled={action.isPending} onClick={() => run('accept')}>
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() => onCounter(offer)}
            >
              Counter
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => run('decline')}
              className="text-muted-foreground"
            >
              Decline
            </Button>
          </div>
        )}
        {live && !forMe && (
          <div className="flex items-center justify-between border-t px-3.5 py-1.5 text-xs text-muted-foreground">
            Waiting for them
            <button
              type="button"
              disabled={action.isPending}
              onClick={() => run('withdraw')}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Withdraw
            </button>
          </div>
        )}
        {offer.status === 'accepted' &&
          (offer.orderId ? (
            <Link
              href={`/orders/${offer.orderId}`}
              className="flex items-center justify-between border-t px-3.5 py-2.5 text-sm font-medium text-primary hover:bg-accent/50"
            >
              View order <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : iBuy ? (
            <div className="border-t p-2">
              <Button size="sm" className="w-full" onClick={() => onCheckout(offer)}>
                Check out
              </Button>
            </div>
          ) : (
            <p className="border-t px-3.5 py-2 text-xs text-muted-foreground">
              Waiting for the buyer to check out
            </p>
          ))}
      </article>
    </div>
  );
}

const VERB: Partial<Record<OfferDto['status'], string>> = {
  accepted: 'accepted the offer',
  declined: 'declined the offer',
  withdrawn: 'withdrew the offer',
};

/** offer_response and system messages: a quiet centred line, not a bubble. */
export function DealEvent({
  message,
  offer,
  me,
  counterpartName,
}: {
  message: MessageDto;
  offer: OfferDto | undefined;
  me: string | undefined;
  counterpartName: string;
}) {
  const who = message.senderId === me ? 'You' : counterpartName;
  let text = message.body ?? '';
  if (message.type === 'offer_response') {
    text =
      offer?.status === 'expired'
        ? `The ${offer ? formatMoney(offer.totalPrice, offer.currency) : ''} offer expired`
        : `${who} ${(offer && VERB[offer.status]) ?? 'replied to the offer'}`;
  }
  return (
    <div className="my-3 text-center text-xs text-muted-foreground">
      <p>
        <span className="rounded-full bg-muted/70 px-3 py-1">{text}</span>
      </p>
      {message.type === 'offer_response' && message.body && (
        <p className="mx-auto mt-1.5 max-w-xs whitespace-pre-wrap break-words italic">
          “{message.body}”
        </p>
      )}
    </div>
  );
}
