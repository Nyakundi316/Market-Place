'use client';

import type { ListingCardDto } from '@markethub/shared';
import { MoreHorizontal, Pencil, Rocket, Send, Tag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useListingAction } from '@/hooks/use-listings';

type Owned = Pick<ListingCardDto, 'id' | 'slug' | 'status' | 'isFeatured' | 'title'>;

/**
 * `layout="panel"` = full buttons on the listing page; `"menu"` = a ⋯ menu
 * on seller dashboard rows. Same actions, same rules.
 */
export function OwnerActions({
  listing: l,
  layout,
  afterDelete,
}: {
  listing: Owned;
  layout: 'panel' | 'menu';
  afterDelete?: string;
}) {
  const action = useListingAction();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const busy = action.isPending;
  const run = (a: 'publish' | 'sold' | 'boost') => action.mutate({ id: l.id, action: a });
  const canPublish = l.status === 'draft' || l.status === 'expired';
  const live = l.status === 'active';

  const confirmDelete = (
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this listing?</DialogTitle>
          <DialogDescription>
            “{l.title}” will disappear from search and your profile. Existing chats keep their
            history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              action.mutate(
                { id: l.id, action: 'delete' },
                {
                  onSuccess: () => {
                    setConfirming(false);
                    if (afterDelete) router.push(afterDelete);
                  },
                },
              )
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (layout === 'menu') {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Manage ${l.title}`} disabled={busy}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canPublish && (
              <DropdownMenuItem onSelect={() => run('publish')}>
                <Send /> Publish
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/create?edit=${l.slug}`}>
                <Pencil /> Edit
              </Link>
            </DropdownMenuItem>
            {live && (
              <>
                <DropdownMenuItem onSelect={() => run('sold')}>
                  <Tag /> Mark as sold
                </DropdownMenuItem>
                {!l.isFeatured && (
                  <DropdownMenuItem onSelect={() => run('boost')}>
                    <Rocket /> Boost for 7 days
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirming(true)}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {confirmDelete}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {canPublish && (
        <Button className="w-full gap-2" disabled={busy} onClick={() => run('publish')}>
          <Send className="size-4" /> Publish listing
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" className="gap-2">
          <Link href={`/create?edit=${l.slug}`}>
            <Pencil className="size-4" /> Edit
          </Link>
        </Button>
        {live ? (
          <Button variant="outline" className="gap-2" disabled={busy} onClick={() => run('sold')}>
            <Tag className="size-4" /> Mark sold
          </Button>
        ) : (
          <Button
            variant="outline"
            className="gap-2 text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
      </div>
      {live && (
        <div className="flex items-center justify-between pt-1 text-sm">
          {l.isFeatured ? (
            <span className="text-muted-foreground">Boosted — shown in Featured</span>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              disabled={busy}
              onClick={() => run('boost')}
            >
              <Rocket className="size-4" /> Boost for 7 days
            </button>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        </div>
      )}
      {confirmDelete}
    </div>
  );
}
